import { ipcMain, safeStorage } from "electron";
import { useStore } from "../store";
import { decodeSyncContent } from "../webdav/sync-codec";
import { webdavLog } from "../logger";

/** WebDAV 公开配置（不含密码） */
export interface WebDavPublicConfig {
  configured: boolean;
  serverUrl: string;
  username: string;
  basePath: string;
}

/** 登录参数 */
interface WebDavLoginPayload {
  serverUrl: string;
  username: string;
  password: string;
  basePath: string;
}

const normalizeServerUrl = (value: string): string => value.trim().replace(/\/+$/, "");

const normalizeBasePath = (value: string): string => value.trim().replace(/^\/+|\/+$/g, "");

/** 拼接目录地址，保证以 / 结尾 */
const buildDirectoryUrl = (serverUrl: string, basePath: string): string => {
  const segments = normalizeBasePath(basePath)
    .split("/")
    .filter((item) => item.length > 0);
  segments.push("");
  return `${normalizeServerUrl(serverUrl)}/${segments.join("/")}`;
};

/** 通过一次文件 GET 校验 WebDAV 账号可用性（404 视为路径可访问） */
const validateConnection = async (payload: WebDavLoginPayload): Promise<void> => {
  const url = new URL(`${buildDirectoryUrl(payload.serverUrl, payload.basePath)}Lyra-sync.json`);
  const auth = Buffer.from(`${payload.username}:${payload.password}`).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("WebDAV 用户名或密码错误");
    }
    if (!response.ok && response.status !== 404) {
      throw new Error(`服务器返回 HTTP ${response.status}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") throw new Error("连接超时，请检查服务器地址");
      if (error.message.startsWith("WebDAV") || error.message.startsWith("服务器")) throw error;
      throw new Error(`无法连接到 WebDAV 服务器：${error.message}`);
    }
    throw new Error("无法连接到 WebDAV 服务器");
  } finally {
    clearTimeout(timer);
  }
};

/** 读取已保存的账号凭据（解密密码） */
const readCredentials = (): WebDavLoginPayload | null => {
  const store = useStore();
  const config = store?.get("webdav");
  if (!config?.serverUrl || !config?.username || !config?.password) return null;
  let password = config.password;
  if (config.encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      password = safeStorage.decryptString(Buffer.from(config.password, "base64"));
    } catch {
      return null;
    }
  }
  return {
    serverUrl: config.serverUrl,
    username: config.username,
    password,
    basePath: config.basePath ?? "",
  };
};

const syncUrl = (payload: WebDavLoginPayload): string =>
  `${buildDirectoryUrl(payload.serverUrl, payload.basePath)}Lyra-sync.json`;

/** 上次读取到的同步文件校验值，用于条件请求，仅在当前会话内有效 */
let syncValidators: { etag?: string; lastModified?: string } = {};

const resetSyncValidators = (): void => {
  syncValidators = {};
};

const SYNC_HEAD_TIMEOUT = 20000;
const SYNC_DOWNLOAD_TIMEOUT = 90000;
const SEGMENT_MIN_BYTES = 64 * 1024;
const SEGMENT_CONCURRENCY = 8;

const authHeader = (payload: WebDavLoginPayload): string =>
  `Basic ${Buffer.from(`${payload.username}:${payload.password}`).toString("base64")}`;

/**
 * 分段并行拉取：单连接被限速时多连接可显著提速
 */
const downloadSegments = async (
  url: string,
  auth: string,
  etag: string,
  total: number,
): Promise<Buffer> => {
  const count = Math.min(SEGMENT_CONCURRENCY, Math.ceil(total / (32 * 1024)));
  const size = Math.ceil(total / count);
  const parts = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const start = index * size;
      const end = Math.min(total - 1, start + size - 1);
      const response = await fetch(url, {
        headers: {
          Authorization: auth,
          Range: `bytes=${start}-${end}`,
          // 文件在下载过程中被其他设备改写时放弃，避免拼出损坏内容
          "If-Match": etag,
        },
        signal: AbortSignal.timeout(SYNC_DOWNLOAD_TIMEOUT),
      });
      if (response.status !== 206) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`分段下载失败：HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length !== end - start + 1) throw new Error("分段下载不完整");
      return buffer;
    }),
  );
  return Buffer.concat(parts);
};

/** 确保远端初始目录存在 */
const ensureDirectory = async (payload: WebDavLoginPayload): Promise<void> => {
  const segments = normalizeBasePath(payload.basePath)
    .split("/")
    .filter((item) => item.length > 0);
  const auth = Buffer.from(`${payload.username}:${payload.password}`).toString("base64");
  let current = normalizeServerUrl(payload.serverUrl);
  for (const segment of segments) {
    current += `/${encodeURIComponent(segment)}`;
    try {
      await fetch(current, {
        method: "MKCOL",
        headers: { Authorization: `Basic ${auth}` },
      });
    } catch {
      // 目录已存在或服务器不支持 MKCOL 时忽略
    }
  }
};

/**
 * 初始化 WebDAV IPC
 */
const initWebDavIpc = (): void => {
  const store = useStore();
  if (!store) return;

  // 读取公开配置
  ipcMain.handle("webdav-get-config", (): WebDavPublicConfig => {
    const config = store.get("webdav");
    return {
      configured: Boolean(config?.serverUrl && config?.username && config?.password),
      serverUrl: config?.serverUrl ?? "",
      username: config?.username ?? "",
      basePath: config?.basePath ?? "",
    };
  });

  // 校验并保存配置
  ipcMain.handle("webdav-login", async (_event, payload: WebDavLoginPayload) => {
    const serverUrl = normalizeServerUrl(payload?.serverUrl ?? "");
    const username = payload?.username?.trim() ?? "";
    const password = payload?.password ?? "";
    const basePath = normalizeBasePath(payload?.basePath ?? "");

    if (!serverUrl || !username || !password) {
      return { success: false, error: "请完整填写服务器 URL、用户名和密码" };
    }
    if (!/^https?:\/\//i.test(serverUrl)) {
      return { success: false, error: "服务器 URL 需要以 http:// 或 https:// 开头" };
    }

    try {
      await validateConnection({ serverUrl, username, password, basePath });
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }

    let encrypted = false;
    let storedPassword = password;
    if (safeStorage.isEncryptionAvailable()) {
      storedPassword = safeStorage.encryptString(password).toString("base64");
      encrypted = true;
    }
    store.set("webdav", { serverUrl, username, basePath, password: storedPassword, encrypted });
    resetSyncValidators();

    return {
      success: true,
      config: { configured: true, serverUrl, username, basePath } satisfies WebDavPublicConfig,
    };
  });

  // 退出登录
  ipcMain.handle("webdav-logout", () => {
    store.delete("webdav");
    resetSyncValidators();
    return true;
  });

  // 上传同步数据
  ipcMain.handle("webdav-sync-upload", async (_event, content: string) => {
    const credentials = readCredentials();
    if (!credentials) return { success: false, error: "尚未配置 WebDAV 账号" };
    if (typeof content !== "string" || !content) {
      return { success: false, error: "同步内容为空" };
    }
    const auth = authHeader(credentials);
    const url = syncUrl(credentials);
    const upload = async (): Promise<Response> =>
      fetch(url, {
        method: "PUT",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: content,
        signal: AbortSignal.timeout(SYNC_DOWNLOAD_TIMEOUT),
      });
    try {
      let response = await upload();
      if (response.status === 404 || response.status === 409) {
        await ensureDirectory(credentials);
        response = await upload();
      }
      if (response.status === 401 || response.status === 403) {
        return { success: false, error: "WebDAV 用户名或密码错误" };
      }
      if (!response.ok) {
        return { success: false, error: `服务器返回 HTTP ${response.status}` };
      }
      // 记录新版本校验值，下次同步可走 304 快路径
      const etag = response.headers.get("etag") || "";
      const lastModified = response.headers.get("last-modified") || "";
      if (etag || lastModified) {
        syncValidators = { etag, lastModified };
      } else {
        try {
          const head = await fetch(url, {
            method: "HEAD",
            headers: { Authorization: auth },
            signal: AbortSignal.timeout(SYNC_HEAD_TIMEOUT),
          });
          if (head.ok) {
            syncValidators = {
              etag: head.headers.get("etag") || "",
              lastModified: head.headers.get("last-modified") || "",
            };
          }
        } catch {
          resetSyncValidators();
        }
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: `上传失败：${(error as Error).message}` };
    }
  });

  // 下载同步数据
  ipcMain.handle("webdav-sync-download", async (_event, forceFull?: boolean) => {
    const credentials = readCredentials();
    if (!credentials) return { success: false, error: "尚未配置 WebDAV 账号" };
    const auth = authHeader(credentials);
    const url = syncUrl(credentials);
    const startedAt = Date.now();
    const conditional: Record<string, string> = { Authorization: auth };
    if (!forceFull) {
      if (syncValidators.etag) conditional["If-None-Match"] = syncValidators.etag;
      else if (syncValidators.lastModified) {
        conditional["If-Modified-Since"] = syncValidators.lastModified;
      }
    }

    try {
      // 先发条件 HEAD：未变化时一两秒返回 304，避免整包下载
      let head: Response | null = null;
      try {
        head = await fetch(url, {
          method: "HEAD",
          headers: conditional,
          signal: AbortSignal.timeout(SYNC_HEAD_TIMEOUT),
        });
      } catch {
        head = null;
      }
      if (head?.status === 304) {
        webdavLog.info(`同步文件未变化，跳过下载（${Date.now() - startedAt}ms）`);
        return { success: true, notModified: true };
      }
      if (head?.status === 404) return { success: true, notFound: true };
      if (head && (head.status === 401 || head.status === 403)) {
        return { success: false, error: "WebDAV 用户名或密码错误" };
      }

      const total = Number(head?.headers.get("content-length") || 0);
      const etag = head?.headers.get("etag") || "";
      const lastModified = head?.headers.get("last-modified") || "";
      const acceptsRanges = (head?.headers.get("accept-ranges") || "")
        .toLowerCase()
        .includes("bytes");

      let buffer: Buffer | null = null;
      let method = "single";
      if (head?.ok && etag && acceptsRanges && total >= SEGMENT_MIN_BYTES) {
        try {
          buffer = await downloadSegments(url, auth, etag, total);
          method = "segments";
        } catch {
          // 分段不被支持或下载中被改写，回退到单连接整包下载
          buffer = null;
        }
      }
      if (!buffer) {
        const response = await fetch(url, {
          headers: conditional,
          signal: AbortSignal.timeout(SYNC_DOWNLOAD_TIMEOUT),
        });
        if (response.status === 304) {
          return { success: true, notModified: true };
        }
        if (response.status === 404) return { success: true, notFound: true };
        if (response.status === 401 || response.status === 403) {
          return { success: false, error: "WebDAV 用户名或密码错误" };
        }
        if (!response.ok) {
          return { success: false, error: `服务器返回 HTTP ${response.status}` };
        }
        buffer = Buffer.from(await response.arrayBuffer());
        if (total > 0 && buffer.length !== total) {
          return { success: false, error: "同步文件下载不完整" };
        }
        syncValidators = {
          etag: response.headers.get("etag") || etag,
          lastModified: response.headers.get("last-modified") || lastModified,
        };
      } else {
        syncValidators = { etag, lastModified };
      }
      const data = decodeSyncContent(buffer);
      webdavLog.info(
        `同步数据下载完成：${buffer.length} 字节，用时 ${Date.now() - startedAt}ms（${method}）`,
      );
      return { success: true, data };
    } catch (error) {
      webdavLog.error(`同步数据下载失败：${(error as Error).message}`);
      return { success: false, error: `下载失败：${(error as Error).message}` };
    }
  });
};

export default initWebDavIpc;
