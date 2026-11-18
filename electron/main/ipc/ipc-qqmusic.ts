import { BrowserWindow, ipcMain, session } from "electron";
import { windowsLog } from "../logger";
import {
  clearQQSession,
  fetchProfile,
  getQQSession,
  saveQQSession,
} from "../../server/qqmusic/home";

const LOGIN_PARTITION = "persist:qqmusic-login";

const readCookies = async (): Promise<Record<string, string>> => {
  const cookies = await session.fromPartition(LOGIN_PARTITION).cookies.get({});
  const result: Record<string, string> = {};
  for (const cookie of cookies) {
    result[cookie.name] = cookie.value;
  }
  return result;
};

const cookieHeader = (values: Record<string, string>): string =>
  Object.entries(values)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

/** 等待用户在官方站点完成登录，读取 cookie 后保存 */
const openLoginWindow = async (): Promise<{ success: boolean; error?: string }> => {
  const win = new BrowserWindow({
    width: 1080,
    height: 760,
    title: "QQ 音乐账号登录",
    autoHideMenuBar: true,
    webPreferences: {
      partition: LOGIN_PARTITION,
      sandbox: true,
      contextIsolation: true,
    },
  });
  win.setMenuBarVisibility(false);

  const current = getQQSession();
  if (current.loggedIn) {
    return { success: true };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { success: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (!win.isDestroyed()) win.close();
      resolve(result);
    };

    const check = async () => {
      try {
        const values = await readCookies();
        const cookie = cookieHeader(values);
        const parsed = cookieValuesUin(values);
        const key = values.qm_keyst || values.qqmusic_key || "";
        if (parsed && key) {
          if (saveQQSession(cookie)) finish({ success: true });
        }
      } catch (error) {
        windowsLog.error("读取 QQ 音乐登录 Cookie 失败", error);
      }
    };

    const timer = setInterval(check, 1200);
    setTimeout(() => finish({ success: false, error: "登录超时，请重试" }), 5 * 60 * 1000);

    win.on("closed", async () => {
      if (settled) return;
      await check();
      finish({ success: false, error: "已取消登录" });
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      win.loadURL(url);
      return { action: "deny" };
    });

    win.loadURL("https://y.qq.com/").catch((error) => {
      windowsLog.error("打开 QQ 音乐登录页失败", error);
      finish({ success: false, error: "无法打开 QQ 音乐登录页" });
    });
  });
};

const cookieValuesUin = (values: Record<string, string>): string => {
  const raw =
    values.qqmusic_uin ||
    (values.login_type === "2" ? values.wxuin : values.uin) ||
    values.wxuin ||
    "";
  return raw.trim().replace(/^o/, "").replace(/\D/g, "");
};

/**
 * QQ 音乐账号 IPC
 */
const initQQMusicIpc = (): void => {
  ipcMain.handle("qqmusic-login", async () => {
    try {
      return await openLoginWindow();
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("qqmusic-get-session", async () => {
    const current = getQQSession();
    if (!current.loggedIn) {
      return { loggedIn: false, uin: "", nickname: "", avatarUrl: "" };
    }
    try {
      const profile = await fetchProfile();
      if (profile) {
        return {
          loggedIn: true,
          uin: profile.uin,
          nickname: profile.nickname,
          avatarUrl: profile.avatarUrl,
        };
      }
    } catch {
      // 资料获取失败时仅返回登录态
    }
    return { loggedIn: true, uin: current.uin, nickname: "", avatarUrl: "" };
  });

  ipcMain.handle("qqmusic-logout", async () => {
    clearQQSession();
    try {
      await session.fromPartition(LOGIN_PARTITION).clearStorageData();
    } catch {
      // 清空失败不影响退出登录
    }
    return true;
  });
};

export default initQQMusicIpc;
