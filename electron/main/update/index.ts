import { app, type BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { updateLog } from "../logger";

/** 更新下载访问源，检查更新始终直连 GitHub API */
export type UpdateSource = "github" | "ghproxy";

/** 更新弹窗所需的信息 */
export interface UpdateInfoType {
  tag: string;
  version: string;
  fileName: string;
  sizeBytes: number;
  updatedAt: number;
  downloadUrl: string;
  releaseNotes: string;
  prerelease: boolean;
}

interface GitHubAsset {
  name: string;
  size: number;
  updated_at: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: GitHubAsset[];
}

const GITHUB_API = "https://api.github.com";
// 仅承载 Windows 桌面版发布，与手机端仓库分开，避免两类更新说明混用
const GITHUB_REPO = "xiaosuyy/Lyra-Windows";
const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "LyraDesktop",
};
// 加速节点：Cloudflare (v4/v6) 优先，故障时依次回退
const GH_PROXY_PREFIXES = [
  "https://v6.gh-proxy.org/",
  "https://v4.gh-proxy.org/",
  "https://gh-proxy.org/",
  "https://ghfast.top/",
];
const GITHUB_DOWNLOAD_HOSTS = new Set(["github.com", "objects.githubusercontent.com"]);
const MAX_CHANGELOG_CHARS = 8000;
const SEMVER_RE = /(?<![\d.])(\d{1,4}\.\d{1,4}(?:\.\d{1,4})?)(?![\d.])/;

const ARCH_TOKENS: Record<string, string[]> = {
  x64: ["x64", "x86_64", "amd64"],
  arm64: ["arm64", "aarch64"],
  ia32: ["ia32", "x86", "386"],
};

let pendingUpdate: UpdateInfoType | null = null;
let downloadedFile: string | null = null;
let downloading = false;

const parseTime = (value?: string | null): number => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
};

const parseSemver = (value: string): number[] | null => {
  const match = value.match(SEMVER_RE);
  return match ? match[1].split(".").map(Number) : null;
};

const compareSemver = (a: number[], b: number[]): number => {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/** 标签优先，标签不含版本号时退回安装包文件名 */
const resolveVersion = (tag: string, fileName: string): string => {
  const label = tag.replace(/^(?:Lyra|NeriPlayer|MeloX)[-_]/i, "").trim();
  return label || fileName.replace(/\.exe$/i, "");
};

const containsToken = (fileName: string, token: string): boolean =>
  new RegExp(
    `(?<![A-Za-z0-9_])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`,
    "i",
  ).test(fileName);

const hasKnownArch = (fileName: string): boolean =>
  Object.values(ARCH_TOKENS).some((tokens) =>
    tokens.some((token) => containsToken(fileName, token)),
  );

/** 选出与本机架构匹配的 Windows 安装包 */
const selectInstaller = (assets: GitHubAsset[]): GitHubAsset | null => {
  const executables = assets.filter((asset) => /\.exe$/i.test(asset.name));
  if (!executables.length) return null;
  // 优先安装版，只有便携版时再退回便携版
  const preferred = executables.filter((asset) => !/portable/i.test(asset.name));
  const installers = preferred.length ? preferred : executables;
  const tokens = ARCH_TOKENS[process.arch] ?? [process.arch];
  const matched = installers.filter((asset) =>
    tokens.some((token) => containsToken(asset.name, token)),
  );
  const candidates = matched.length
    ? matched
    : installers.filter((asset) => !hasKnownArch(asset.name));
  return (
    [...candidates].sort((a, b) => parseTime(b.updated_at) - parseTime(a.updated_at))[0] ?? null
  );
};

/** latest 接口在只有预发布版本时返回 404，此时回退到最近的发布列表 */
const fetchLatestRelease = async (): Promise<GitHubRelease> => {
  const request = async (url: string): Promise<Response> => {
    const response = await fetch(url, { headers: GITHUB_HEADERS });
    if (response.status === 404) return response;
    if (!response.ok) {
      const rateLimited =
        (response.status === 403 || response.status === 429) &&
        response.headers.get("x-ratelimit-remaining") === "0";
      throw new Error(
        rateLimited
          ? "GitHub API 请求次数已达上限，请稍后重试"
          : `GitHub API 请求失败：${response.status}`,
      );
    }
    return response;
  };

  const latest = await request(`${GITHUB_API}/repos/${GITHUB_REPO}/releases/latest`);
  if (latest.status !== 404) return (await latest.json()) as GitHubRelease;

  const listResponse = await request(`${GITHUB_API}/repos/${GITHUB_REPO}/releases?per_page=10`);
  const releases = ((await listResponse.json()) as GitHubRelease[]).filter(
    (release) => !release.draft,
  );
  const release = releases.find((item) => !item.prerelease) ?? releases[0];
  if (!release) throw new Error("未找到可用的发布版本");
  return release;
};

/** 记录当前版本首次运行时间，用于判断 Release 资产是否在安装之后更新 */
const readInstalledAt = async (): Promise<number> => {
  const statePath = join(app.getPath("userData"), "update-state.json");
  const version = app.getVersion();
  try {
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      version?: string;
      installedAt?: number;
    };
    if (state.version === version && typeof state.installedAt === "number")
      return state.installedAt;
  } catch {
    // 首次运行时还没有状态文件
  }
  const installedAt = Date.now();
  await writeFile(statePath, JSON.stringify({ version, installedAt }), "utf8").catch(
    () => undefined,
  );
  return installedAt;
};

const buildDownloadUrls = (url: string, source: UpdateSource): string[] => {
  if (source !== "ghproxy") return [url];
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !GITHUB_DOWNLOAD_HOSTS.has(parsed.hostname)) return [url];
    return GH_PROXY_PREFIXES.map((prefix) => `${prefix}${url}`);
  } catch {
    return [url];
  }
};

const getUpdateDir = () => join(app.getPath("userData"), "updates");

/** 分段并行下载，单连接被节点限速时可明显提速 */
const DOWNLOAD_CONCURRENCY = 4;
const SEGMENTED_MIN_BYTES = 16 * 1024 * 1024;

const downloadSegment = async (
  url: string,
  start: number,
  end: number,
  filePath: string,
  signal: AbortSignal,
  onChunk: (length: number) => void,
): Promise<void> => {
  const response = await fetch(url, {
    headers: { "User-Agent": "LyraDesktop", Range: `bytes=${start}-${end}` },
    redirect: "follow",
    signal,
  });
  if (response.status !== 206 || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`分段下载失败：HTTP ${response.status}`);
  }
  const expected = end - start + 1;
  let received = 0;
  const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    received += chunk.length;
    onChunk(chunk.length);
  });
  await pipeline(body, createWriteStream(filePath));
  if (received !== expected) throw new Error("分段下载不完整");
};

const mergeSegments = async (parts: string[], target: string): Promise<void> => {
  const output = createWriteStream(target);
  try {
    for (const part of parts) {
      await new Promise<void>((resolve, reject) => {
        const input = createReadStream(part);
        input.on("error", reject);
        input.on("end", resolve);
        input.pipe(output, { end: false });
      });
    }
  } finally {
    await new Promise<void>((resolve) => output.end(resolve));
  }
};

export const checkUpdate = async (
  win: BrowserWindow,
  showTip: boolean = false,
  source: UpdateSource = "github",
): Promise<void> => {
  // 开发环境没有真实安装目录，避免误触更新安装
  if (!app.isPackaged) {
    updateLog.info("开发模式跳过在线更新检查");
    if (showTip) win.webContents.send("update-not-available");
    return;
  }
  try {
    const release = await fetchLatestRelease();
    const asset = selectInstaller(release.assets ?? []);
    if (!asset) {
      updateLog.info(`最新发布 ${release.tag_name} 中没有 Windows 安装包`);
      if (showTip) win.webContents.send("update-not-available");
      return;
    }

    const installedAt = await readInstalledAt();
    const updatedAt = parseTime(asset.updated_at);
    const version = resolveVersion(release.tag_name ?? "", asset.name);
    const remoteSemver = parseSemver(version);
    const currentSemver = parseSemver(app.getVersion());
    const newerVersion =
      remoteSemver && currentSemver ? compareSemver(remoteSemver, currentSemver) > 0 : false;
    if (!newerVersion && updatedAt <= installedAt) {
      updateLog.info(`当前已是最新版本：${app.getVersion()}`);
      if (showTip) win.webContents.send("update-not-available");
      return;
    }

    pendingUpdate = {
      tag: release.tag_name ?? "",
      version,
      fileName: asset.name,
      sizeBytes: asset.size || 0,
      updatedAt,
      downloadUrl: asset.browser_download_url,
      releaseNotes: (release.body ?? "").trim().slice(0, MAX_CHANGELOG_CHARS) || "暂无更新日志",
      prerelease: Boolean(release.prerelease),
    };
    downloadedFile = null;
    updateLog.info(`发现新版本 ${version}（${asset.name}），下载源：${source}`);
    win.webContents.send("update-available", pendingUpdate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "检查更新失败";
    updateLog.error(`检查更新失败：${message}`);
    if (showTip) win.webContents.send("update-check-error", message);
  }
};

export const startDownloadUpdate = async (
  win: BrowserWindow,
  source: UpdateSource = "github",
): Promise<void> => {
  if (downloading) return;
  if (downloadedFile) {
    win.webContents.send("update-downloaded", { path: downloadedFile });
    return;
  }
  const update = pendingUpdate;
  if (!update) {
    win.webContents.send("update-error", "没有可下载的更新");
    return;
  }

  downloading = true;
  const updateDir = getUpdateDir();
  const safeName = update.fileName.replace(/[^A-Za-z0-9._-]/g, "_") || "Lyra-update.exe";
  const target = join(updateDir, safeName);
  const partFile = `${target}.part`;
  try {
    await mkdir(updateDir, { recursive: true });
    for (const file of await readdir(updateDir).catch(() => [])) {
      await rm(join(updateDir, file), { force: true }).catch(() => undefined);
    }

    const candidates = buildDownloadUrls(update.downloadUrl, source);
    const total = update.sizeBytes;
    let progressTotal = total;
    let received = 0;
    let lastReportAt = 0;
    const onChunk = (length: number) => {
      received += length;
      const now = Date.now();
      if (now - lastReportAt >= 200) {
        lastReportAt = now;
        win.webContents.send("download-progress", {
          percent: progressTotal > 0 ? Math.min(100, (received / progressTotal) * 100) : 0,
        });
      }
    };

    let lastError: unknown = null;
    let completed = false;

    if (total >= SEGMENTED_MIN_BYTES) {
      const count = Math.min(DOWNLOAD_CONCURRENCY, Math.ceil(total / (8 * 1024 * 1024)));
      const segmentSize = Math.ceil(total / count);
      for (const url of candidates) {
        const parts = Array.from({ length: count }, (_, index) => `${partFile}.${index}`);
        const controller = new AbortController();
        const tasks = parts.map((part, index) => {
          const start = index * segmentSize;
          const end = Math.min(total - 1, start + segmentSize - 1);
          return downloadSegment(url, start, end, part, controller.signal, onChunk);
        });
        updateLog.info(`开始分段下载更新（${count} 线程）：${url}`);
        try {
          await Promise.all(tasks);
          await mergeSegments(parts, partFile);
          const { size } = await stat(partFile);
          if (size !== total) throw new Error(`更新包大小不一致：${size}/${total}`);
          await Promise.all(parts.map((part) => rm(part, { force: true }).catch(() => undefined)));
          completed = true;
          break;
        } catch (error) {
          lastError = error;
          controller.abort();
          await Promise.allSettled(tasks);
          await Promise.all(parts.map((part) => rm(part, { force: true }).catch(() => undefined)));
          await rm(partFile, { force: true }).catch(() => undefined);
          received = 0;
        }
      }
    }

    // 分段不被支持时退回单连接下载
    if (!completed) {
      let response: Awaited<ReturnType<typeof fetch>> | null = null;
      for (const url of candidates) {
        updateLog.info(`开始下载更新：${url}`);
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": "LyraDesktop" },
            redirect: "follow",
          });
          // 节点异常时可能返回错误页，大小不符直接切换下一个节点
          const length = Number(res.headers.get("content-length") || 0);
          if (!res.ok || !res.body || (length > 0 && total > 0 && length !== total)) {
            await res.body?.cancel().catch(() => undefined);
            lastError = new Error(`下载失败：HTTP ${res.status}`);
            continue;
          }
          response = res;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!response?.body) {
        throw lastError instanceof Error ? lastError : new Error("下载更新失败");
      }

      progressTotal = Number(response.headers.get("content-length") || 0) || total;
      received = 0;
      const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      body.on("data", (chunk: Buffer) => onChunk(chunk.length));
      await pipeline(body, createWriteStream(partFile));
    }

    await rename(partFile, target);

    downloadedFile = target;
    updateLog.info(`更新下载完成：${target}`);
    win.webContents.send("update-downloaded", { path: target });
  } catch (error) {
    for (const file of await readdir(updateDir).catch(() => [])) {
      await rm(join(updateDir, file), { force: true }).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "下载更新失败";
    updateLog.error(`下载更新失败：${message}`);
    win.webContents.send("update-error", message);
  } finally {
    downloading = false;
  }
};

/** 启动安装包后退出应用，由安装程序接管更新 */
export const installUpdate = (): void => {
  if (!downloadedFile) {
    updateLog.warn("尚未下载更新，忽略安装请求");
    return;
  }
  updateLog.info(`启动安装程序：${downloadedFile}`);
  const child = spawn(downloadedFile, [], { detached: true, stdio: "ignore" });
  child.unref();
  setTimeout(() => app.quit(), 600);
};
