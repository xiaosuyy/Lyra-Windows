import { defineStore } from "pinia";
import { isElectron } from "@/utils/env";

interface WebDavConfig {
  configured: boolean;
  serverUrl: string;
  username: string;
  basePath: string;
}

interface QQSession {
  loggedIn: boolean;
  uin: string;
  nickname: string;
  avatarUrl: string;
}

/** 手机端同步过来的个人资料 */
export interface SyncedProfile {
  displayName?: string;
  avatarBase64?: string;
  updatedAt?: number;
}

const PROFILE_STORAGE_KEY = "lyra-synced-profile";

/**
 * 账号状态：WebDAV、QQ 音乐
 */
export const useAccountStore = defineStore("account", () => {
  // WebDAV
  const configured = ref(false);
  const serverUrl = ref("");
  const username = ref("");
  const basePath = ref("");
  const loading = ref(false);

  // QQ 音乐
  const qqLoggedIn = ref(false);
  const qqUin = ref("");
  const qqNickname = ref("");
  const qqAvatar = ref("");
  const qqLoading = ref(false);

  // 手机端同步的个人资料
  const profileName = ref("");
  const profileAvatar = ref("");
  const profileUpdatedAt = ref(0);

  // 展示名称
  const displayName = computed(() => username.value || "WebDAV 用户");
  const qqDisplayName = computed(() => qqNickname.value || qqUin.value || "QQ音乐用户");

  // 头像地址（手机端存的是 JPEG base64）
  const profileAvatarUrl = computed(() => {
    const avatar = profileAvatar.value.trim();
    if (!avatar) return "";
    return avatar.startsWith("data:") ? avatar : `data:image/jpeg;base64,${avatar}`;
  });

  // 读取本地缓存的资料
  const loadProfile = () => {
    try {
      const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      profileName.value = String(data?.displayName || "");
      profileAvatar.value = String(data?.avatarBase64 || "");
      profileUpdatedAt.value = Number(data?.updatedAt) || 0;
    } catch (error) {
      console.warn("读取同步资料失败", error);
    }
  };

  // 缓存资料到 localStorage
  const persistProfile = () => {
    try {
      localStorage.setItem(
        PROFILE_STORAGE_KEY,
        JSON.stringify({
          displayName: profileName.value,
          avatarBase64: profileAvatar.value,
          updatedAt: profileUpdatedAt.value,
        }),
      );
    } catch (error) {
      console.warn("保存同步资料失败", error);
    }
  };

  // 应用手机端同步资料（更新时间较新才覆盖）
  const applySyncedProfile = (profile: SyncedProfile) => {
    const updatedAt = Number(profile.updatedAt) || 0;
    if (updatedAt <= profileUpdatedAt.value) return;
    profileName.value = String(profile.displayName || "").trim();
    profileAvatar.value = String(profile.avatarBase64 || "").trim();
    profileUpdatedAt.value = updatedAt;
    persistProfile();
  };

  // 修改本机资料（头像 base64 / 昵称），随后随 WebDAV 同步到手机端
  const updateProfile = async (patch: { displayName?: string; avatarBase64?: string }) => {
    if (patch.displayName !== undefined) profileName.value = String(patch.displayName).trim();
    if (patch.avatarBase64 !== undefined) profileAvatar.value = String(patch.avatarBase64).trim();
    profileUpdatedAt.value = Date.now();
    persistProfile();
  };

  const applyConfig = (config: WebDavConfig) => {
    configured.value = config.configured;
    serverUrl.value = config.serverUrl;
    username.value = config.username;
    basePath.value = config.basePath;
  };

  // 读取本地配置
  const load = async () => {
    loadProfile();
    if (!isElectron) return;
    await Promise.allSettled([loadWebDav(), loadQQ()]);
  };

  const loadWebDav = async () => {
    if (!isElectron) return;
    try {
      applyConfig(await window.api.webdav.getConfig());
    } catch (error) {
      console.error("读取 WebDAV 配置失败", error);
    }
  };

  const loadQQ = async () => {
    if (!isElectron) return;
    try {
      const session: QQSession = await window.api.qqmusic.getSession();
      qqLoggedIn.value = session.loggedIn;
      qqUin.value = session.uin;
      qqNickname.value = session.nickname;
      qqAvatar.value = session.avatarUrl;
    } catch (error) {
      console.error("读取 QQ 音乐账号失败", error);
    }
  };

  // 校验并登录 WebDAV
  const login = async (payload: {
    serverUrl: string;
    username: string;
    password: string;
    basePath: string;
  }) => {
    loading.value = true;
    try {
      const result = await window.api.webdav.login(payload);
      if (result.success && result.config) {
        applyConfig(result.config);
      }
      return result;
    } finally {
      loading.value = false;
    }
  };

  // 退出 WebDAV
  const logout = async () => {
    if (isElectron) {
      await window.api.webdav.logout();
    }
    applyConfig({ configured: false, serverUrl: "", username: "", basePath: "" });
  };

  // 登录 QQ 音乐
  const loginQQ = async () => {
    if (!isElectron) return { success: false, error: "仅桌面端支持" };
    qqLoading.value = true;
    try {
      const result = await window.api.qqmusic.login();
      if (result.success) await loadQQ();
      return result;
    } finally {
      qqLoading.value = false;
    }
  };

  // 退出 QQ 音乐
  const logoutQQ = async () => {
    if (isElectron) await window.api.qqmusic.logout();
    qqLoggedIn.value = false;
    qqUin.value = "";
    qqNickname.value = "";
    qqAvatar.value = "";
  };

  return {
    configured,
    serverUrl,
    username,
    basePath,
    loading,
    displayName,
    profileName,
    profileAvatar,
    profileUpdatedAt,
    profileAvatarUrl,
    applySyncedProfile,
    updateProfile,
    loadProfile,
    load,
    login,
    logout,
    qqLoggedIn,
    qqUin,
    qqNickname,
    qqAvatar,
    qqLoading,
    qqDisplayName,
    loadQQ,
    loginQQ,
    logoutQQ,
  };
});
