import { ipcMain, safeStorage } from "electron";
import { useStore } from "../store";
import { decodeSyncContent } from "../webdav/sync-codec";

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

    return {
      success: true,
      config: { configured: true, serverUrl, username, basePath } satisfies WebDavPublicConfig,
    };
  });

  // 退出登录
  ipcMain.handle("webdav-logout", () => {
    store.delete("webdav");
    return true;
  });

  // 上传同步数据
  ipcMain.handle("webdav-sync-upload", async (_event, content: string) => {
    const credentials = readCredentials();
    if (!credentials) return { success: false, error: "尚未配置 WebDAV 账号" };
    if (typeof content !== "string" || !content) {
      return { success: false, error: "同步内容为空" };
    }
    const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
    const upload = async (): Promise<Response> =>
      fetch(syncUrl(credentials), {
        method: "PUT",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: content,
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
      return { success: true };
    } catch (error) {
      return { success: false, error: `上传失败：${(error as Error).message}` };
    }
  });

  // 下载同步数据
  ipcMain.handle("webdav-sync-download", async () => {
    const credentials = readCredentials();
    if (!credentials) return { success: false, error: "尚未配置 WebDAV 账号" };
    const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
    try {
      const response = await fetch(syncUrl(credentials), {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (response.status === 404) return { success: true, notFound: true };
      if (response.status === 401 || response.status === 403) {
        return { success: false, error: "WebDAV 用户名或密码错误" };
      }
      if (!response.ok) {
        return { success: false, error: `服务器返回 HTTP ${response.status}` };
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const data = decodeSyncContent(buffer);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: `下载失败：${(error as Error).message}` };
    }
  });
};

export default initWebDavIpc;
