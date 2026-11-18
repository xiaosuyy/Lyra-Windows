<template>
  <div class="account-setting">
    <!-- 首页音源 -->
    <n-h3 prefix="bar">首页内容源</n-h3>
    <n-card class="set-card" :bordered="false">
      <div class="source-select">
        <button
          type="button"
          class="source-option"
          :class="{ active: settingStore.homeSource === 'netease' }"
          @click="settingStore.homeSource = 'netease'"
        >
          <span class="source-icon netease"><SvgIcon name="Music" :size="26" /></span>
          <span class="source-copy">
            <span class="source-name">网易云音乐</span>
            <span class="source-desc">推荐歌单 · 雷达 · 播客 · 新碟</span>
          </span>
          <SvgIcon
            v-if="settingStore.homeSource === 'netease'"
            class="source-check"
            name="Check"
            :size="20"
          />
        </button>
        <button
          type="button"
          class="source-option"
          :class="{ active: settingStore.homeSource === 'tencent' }"
          @click="settingStore.homeSource = 'tencent'"
        >
          <span class="source-icon tencent"><SvgIcon name="QQ" :size="26" /></span>
          <span class="source-copy">
            <span class="source-name">QQ 音乐</span>
            <span class="source-desc">每日推荐 · 热门榜单 · 新歌速递</span>
          </span>
          <SvgIcon
            v-if="settingStore.homeSource === 'tencent'"
            class="source-check"
            name="Check"
            :size="20"
          />
        </button>
      </div>
    </n-card>

    <!-- 播放源 -->
    <n-h3 prefix="bar" class="group-gap">播放源</n-h3>
    <n-card class="set-card" :bordered="false">
      <div class="manage-row">
        <div class="manage-info">
          <div class="account-name">本地音乐兜底</div>
          <div class="account-desc">在线音源解析失败时回退到已缓存的歌曲文件</div>
        </div>
        <n-switch v-model:value="settingStore.songCacheEnabled" />
      </div>
      <div class="manage-row">
        <div class="manage-info">
          <div class="account-name">音源解锁</div>
          <div class="account-desc">官方无版权时使用 Lyra 音源脚本解析播放地址</div>
        </div>
        <n-switch v-model:value="settingStore.useSongUnlock" />
      </div>
      <n-divider class="manage-divider" />
      <div class="script-head">
        <div class="manage-info">
          <div class="account-name">自定义源（音源脚本）</div>
          <div class="account-desc">内置脚本随应用更新，可单独启停或导入 lx-music 音源脚本</div>
        </div>
        <n-button quaternary size="small" :loading="scriptsLoading" @click="loadScripts()">
          刷新
        </n-button>
      </div>
      <div class="script-list">
        <div v-for="script in scripts" :key="script.id" class="script-row">
          <div class="script-info">
            <div class="script-name">
              {{ script.name }}
              <n-text v-if="script.version" depth="3" class="script-version">
                v{{ script.version }}
              </n-text>
              <n-tag size="small" :bordered="false" :type="script.builtin ? 'default' : 'info'">
                {{ script.builtin ? "内置" : "自定义" }}
              </n-tag>
            </div>
            <div class="script-desc">{{ scriptDesc(script) }}</div>
            <div v-if="!script.ready && script.error" class="script-error">
              {{ script.error }}
            </div>
          </div>
          <n-switch
            :value="script.enabled"
            :disabled="!script.ready"
            @update:value="(value: boolean) => handleToggle(script, value)"
          />
          <n-button v-if="!script.builtin" text type="error" @click="handleRemove(script)">
            删除
          </n-button>
        </div>
        <n-empty
          v-if="!scriptsLoading && !scripts.length"
          size="small"
          description="还没有音源脚本"
        />
      </div>
      <div class="script-actions">
        <n-button quaternary type="primary" @click="showImport = true">导入音源脚本</n-button>
        <n-button quaternary :loading="scriptsLoading" @click="handleReload">重新加载音源</n-button>
      </div>
      <n-text class="script-tip" depth="3">
        按列表顺序尝试已启用的音源；关闭开关后该脚本不再参与检索与取链。
      </n-text>
    </n-card>

    <!-- WebDAV 云同步 -->
    <n-h3 prefix="bar" class="group-gap">云同步（WebDAV）</n-h3>
    <n-card class="set-card" :bordered="false">
      <div class="account-row">
        <img
          v-if="accountStore.profileAvatarUrl"
          class="avatar-img"
          :src="accountStore.profileAvatarUrl"
          alt="Lyra 头像"
        />
        <span v-else class="account-avatar webdav">
          <SvgIcon name="Cloud" :size="26" />
        </span>
        <div class="account-info">
          <div class="account-name">
            {{
              accountStore.profileName ||
              (accountStore.configured ? accountStore.displayName : "未登录 WebDAV")
            }}
          </div>
          <div class="account-desc">
            {{
              accountStore.configured
                ? accountStore.serverUrl
                : "登录后可在多设备间同步收藏、歌单与播放记录"
            }}
          </div>
        </div>
        <n-flex class="account-actions" :size="8">
          <template v-if="accountStore.configured">
            <n-button
              :focusable="false"
              type="primary"
              strong
              round
              :loading="libraryStore.syncing"
              @click="libraryStore.syncNow()"
            >
              立即同步
            </n-button>
            <n-button :focusable="false" secondary round @click="handleWebDavLogin">
              重新配置
            </n-button>
            <n-button :focusable="false" quaternary round @click="handleWebDavLogout">
              退出
            </n-button>
          </template>
          <n-button
            v-else
            :focusable="false"
            type="primary"
            strong
            round
            @click="handleWebDavLogin"
          >
            WebDAV 登录
          </n-button>
        </n-flex>
      </div>
      <div v-if="accountStore.configured" class="sync-row">
        <div class="sync-switch">
          <div class="account-name">自动同步</div>
          <div class="account-desc">收藏或歌单变化后自动合并，并每 5 分钟同步一次</div>
        </div>
        <n-switch v-model:value="settingStore.webdavAutoSync" />
      </div>
      <div
        v-if="accountStore.configured && (libraryStore.lastSyncAt || libraryStore.syncError)"
        class="sync-meta"
      >
        <n-text v-if="libraryStore.syncError" type="error" depth="3">
          同步失败：{{ libraryStore.syncError }}
        </n-text>
        <n-text v-else depth="3">
          上次同步：{{ formatTimestamp(libraryStore.lastSyncAt, "MM-DD HH:mm") }}
        </n-text>
      </div>
    </n-card>

    <!-- 网易云音乐 -->
    <n-h3 prefix="bar" class="group-gap">音乐账号</n-h3>
    <n-card class="set-card" :bordered="false">
      <div class="account-row">
        <img
          class="avatar-img"
          :src="
            neteaseLogged ? dataStore.userData.avatarUrl || avatarPlaceholder : avatarPlaceholder
          "
          alt="网易云音乐头像"
        />
        <div class="account-info">
          <div class="account-name">
            {{ neteaseLogged ? dataStore.userData.name || "网易云用户" : "未登录网易云音乐" }}
          </div>
          <div class="account-desc">
            {{
              neteaseLogged
                ? `UID ${dataStore.userData.userId} · 登录后可获取每日推荐`
                : "登录后可获取每日推荐、收藏与歌单"
            }}
          </div>
        </div>
        <n-flex class="account-actions" :size="8">
          <n-button
            v-if="!neteaseLogged"
            :focusable="false"
            type="primary"
            strong
            round
            @click="handleNeteaseLogin"
          >
            登录
          </n-button>
          <template v-else>
            <n-tag type="success" round :bordered="false">已登录</n-tag>
            <n-button :focusable="false" quaternary round @click="handleNeteaseLogout"
              >退出</n-button
            >
          </template>
        </n-flex>
      </div>
    </n-card>

    <!-- QQ 音乐 -->
    <n-card class="set-card" :bordered="false">
      <div class="account-row">
        <img
          v-if="accountStore.qqAvatar"
          class="avatar-img"
          :src="accountStore.qqAvatar"
          alt="QQ 音乐头像"
        />
        <span v-else class="account-avatar qq">
          <SvgIcon name="QQ" :size="26" />
        </span>
        <div class="account-info">
          <div class="account-name">
            {{ accountStore.qqLoggedIn ? accountStore.qqDisplayName : "未登录 QQ 音乐" }}
          </div>
          <div class="account-desc">
            {{
              accountStore.qqLoggedIn
                ? `QQ ${accountStore.qqUin} · 已开启每日推荐与榜单`
                : "登录后可获取每日推荐、榜单与更完整的歌曲信息"
            }}
          </div>
        </div>
        <n-flex class="account-actions" :size="8">
          <n-button
            v-if="!accountStore.qqLoggedIn"
            :focusable="false"
            type="primary"
            strong
            round
            :loading="accountStore.qqLoading"
            @click="handleQQLogin"
          >
            登录
          </n-button>
          <template v-else>
            <n-tag type="success" round :bordered="false">已登录</n-tag>
            <n-button :focusable="false" quaternary round @click="handleQQLogout">退出</n-button>
          </template>
        </n-flex>
      </div>
    </n-card>

    <!-- 离线音乐库 -->
    <n-h3 prefix="bar" class="group-gap">离线音乐库</n-h3>
    <n-card class="set-card" :bordered="false">
      <div class="library-stats">
        <div class="stat">
          <span class="stat-value">{{ libraryStore.createdPlaylists.length }}</span>
          <span class="stat-label">创建歌单</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ libraryStore.likedPlaylists.length }}</span>
          <span class="stat-label">收藏歌单</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ dataStore.likeSongsList.data.length }}</span>
          <span class="stat-label">喜欢歌曲</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ dataStore.historyList.length }}</span>
          <span class="stat-label">最近播放</span>
        </div>
      </div>
      <n-text class="library-tip" depth="3">
        喜欢的音乐、收藏与创建的歌单、最近播放均保存在本地，可离线使用；登录 WebDAV
        后会自动合并同步。
      </n-text>
    </n-card>

    <!-- 导入音源脚本 -->
    <n-modal
      v-model:show="showImport"
      preset="card"
      title="导入音源脚本"
      class="import-modal"
      style="width: 520px; max-width: 92vw"
      :bordered="false"
    >
      <div class="import-body">
        <div class="import-label">脚本 URL</div>
        <n-input
          v-model:value="importUrl"
          placeholder="https://example.com/source.js"
          clearable
          :disabled="importing"
          @update:value="importContent = ''"
        />
        <n-text class="import-hint" depth="3">输入在线音源脚本地址，将自动下载并导入</n-text>
        <n-divider class="import-divider">或</n-divider>
        <n-button secondary :disabled="importing" @click="fileInput?.click()">
          从本地文件导入
        </n-button>
        <n-text v-if="importFileName" class="import-file" depth="3">
          已选择：{{ importFileName }}
        </n-text>
        <input
          ref="fileInput"
          type="file"
          accept=".js,text/javascript,application/javascript"
          hidden
          @change="handleFilePick"
        />
      </div>
      <template #footer>
        <n-flex justify="end" :size="8">
          <n-button quaternary :disabled="importing" @click="showImport = false">取消</n-button>
          <n-button
            type="primary"
            strong
            :loading="importing"
            :disabled="!importUrl.trim() && !importContent"
            @click="submitImport"
          >
            导入
          </n-button>
        </n-flex>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { useAccountStore, useDataStore, useLibraryStore, useSettingStore } from "@/stores";
import { isLogin, toLogout } from "@/utils/auth";
import { formatTimestamp } from "@/utils/time";
import { openUserLogin, openWebDavLogin } from "@/utils/modal";
import {
  getLyraScripts,
  importLyraScript,
  reloadLyraScripts,
  removeLyraScript,
  toggleLyraScript,
  type LyraScriptInfo,
} from "@/api/lyraSource";
import avatarPlaceholder from "@/assets/lyra-avatar.png";

const settingStore = useSettingStore();
const accountStore = useAccountStore();
const dataStore = useDataStore();
const libraryStore = useLibraryStore();

const neteaseLogged = computed(() => isLogin() !== 0);

// 音源脚本
const scripts = ref<LyraScriptInfo[]>([]);
const scriptsLoading = ref(false);
const showImport = ref(false);
const importUrl = ref("");
const importContent = ref("");
const importFileName = ref("");
const importing = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const SOURCE_LABELS: Record<string, string> = {
  wy: "网易云",
  tx: "QQ 音乐",
  kg: "酷狗",
  kw: "酷我",
  mg: "咪咕",
};

const scriptDesc = (script: LyraScriptInfo) => {
  if (!script.ready) return script.error || "脚本未就绪";
  const sources = script.sources
    .map((source) => SOURCE_LABELS[source.id] ?? source.id)
    .filter(Boolean);
  return sources.length ? sources.join(" · ") : "未声明音源";
};

const loadScripts = async (silent = false) => {
  scriptsLoading.value = true;
  try {
    const list = await getLyraScripts();
    if (list) scripts.value = list;
  } catch {
    if (!silent) window.$message.error("音源脚本读取失败");
  } finally {
    scriptsLoading.value = false;
  }
};

const handleToggle = async (script: LyraScriptInfo, enabled: boolean) => {
  try {
    const list = await toggleLyraScript(script.id, enabled);
    if (list) scripts.value = list;
    window.$message.success(enabled ? `已启用 ${script.name}` : `已停用 ${script.name}`);
  } catch {
    window.$message.error("音源切换失败");
  }
};

const handleRemove = (script: LyraScriptInfo) => {
  window.$dialog.warning({
    title: "删除音源脚本",
    content: `确认删除「${script.name}」？`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        const list = await removeLyraScript(script.id);
        if (list) scripts.value = list;
        window.$message.success("已删除音源脚本");
      } catch {
        window.$message.error("删除失败");
      }
    },
  });
};

const handleReload = async () => {
  scriptsLoading.value = true;
  try {
    const list = await reloadLyraScripts();
    if (list) scripts.value = list;
    window.$message.success("已重新加载音源脚本");
  } catch {
    window.$message.error("重新加载失败");
  } finally {
    scriptsLoading.value = false;
  }
};

const handleFilePick = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    window.$message.warning("脚本文件不能超过 2MB");
    return;
  }
  importContent.value = await file.text();
  importFileName.value = file.name;
  importUrl.value = "";
};

const submitImport = async () => {
  importing.value = true;
  try {
    const list = await importLyraScript({
      url: importUrl.value.trim() || undefined,
      name: importFileName.value || undefined,
      content: importContent.value || undefined,
    });
    if (list) scripts.value = list;
    showImport.value = false;
    importUrl.value = "";
    importContent.value = "";
    importFileName.value = "";
    window.$message.success("已导入音源脚本");
  } catch {
    window.$message.error("导入失败，请确认是有效的 .js 音源脚本");
  } finally {
    importing.value = false;
  }
};

const handleWebDavLogin = () => {
  openWebDavLogin(async () => {
    await accountStore.load();
    await libraryStore.syncNow(true);
  });
};

const handleWebDavLogout = () => {
  window.$dialog.warning({
    title: "退出 WebDAV",
    content: "确认退出当前 WebDAV 账号？本地音乐库不会被删除。",
    positiveText: "退出",
    negativeText: "取消",
    onPositiveClick: async () => {
      await accountStore.logout();
      window.$message.success("已退出 WebDAV");
    },
  });
};

const handleNeteaseLogin = () => openUserLogin();

const handleNeteaseLogout = () => {
  window.$dialog.warning({
    title: "退出网易云音乐",
    content: "确认退出当前网易云音乐账号？",
    positiveText: "退出",
    negativeText: "取消",
    onPositiveClick: async () => {
      await toLogout();
    },
  });
};

const handleQQLogin = async () => {
  const result = await accountStore.loginQQ();
  if (result?.success) window.$message.success("QQ 音乐登录成功");
  else if (result?.error) window.$message.error(result.error);
};

const handleQQLogout = () => {
  window.$dialog.warning({
    title: "退出 QQ 音乐",
    content: "确认退出当前 QQ 音乐账号？",
    positiveText: "退出",
    negativeText: "取消",
    onPositiveClick: async () => {
      await accountStore.logoutQQ();
      window.$message.success("已退出 QQ 音乐");
    },
  });
};

onMounted(() => {
  accountStore.load();
  loadScripts(true);
});
</script>

<style lang="scss" scoped>
.account-setting {
  padding-bottom: 20px;
  .group-gap {
    margin-top: 30px;
  }
  .set-card {
    margin-bottom: 12px;
    border-radius: 10px;
    background-color: var(--surface-container-hex);
    :deep(.n-card__content) {
      padding: 18px;
    }
  }
  .source-select {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    .source-option {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px;
      border: 2px solid transparent;
      border-radius: 12px;
      background-color: var(--surface-color);
      text-align: left;
      cursor: pointer;
      transition:
        border-color 0.25s,
        background-color 0.25s,
        transform 0.2s;
      &:hover {
        transform: translateY(-1px);
      }
      &.active {
        border-color: rgba(var(--primary), 0.55);
      }
      .source-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 46px;
        height: 46px;
        flex-shrink: 0;
        border-radius: 14px;
        color: #fff;
        &.netease {
          background: linear-gradient(135deg, #ff6b6b, #f03e3e);
        }
        &.tencent {
          background: linear-gradient(135deg, #4dabf7, #1c7ed6);
        }
      }
      .source-copy {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        .source-name {
          font-size: 15px;
          font-weight: 700;
        }
        .source-desc {
          font-size: 12px;
          color: var(--text-color-3);
        }
      }
      .source-check {
        margin-left: auto;
        color: var(--primary-hex);
      }
    }
  }
  .account-row {
    display: flex;
    align-items: center;
    gap: 14px;
    .avatar-img,
    .account-avatar {
      width: 48px;
      height: 48px;
      flex-shrink: 0;
      border-radius: 50%;
      object-fit: cover;
    }
    .account-avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      &.webdav {
        background: linear-gradient(135deg, #845ef7, #5c7cfa);
      }
      &.qq {
        background: linear-gradient(135deg, #4dabf7, #1c7ed6);
      }
    }
    .account-info {
      min-width: 0;
      flex: 1;
      .account-name {
        font-size: 15px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .account-desc {
        margin-top: 3px;
        font-size: 12px;
        color: var(--text-color-3);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
    .account-actions {
      flex-shrink: 0;
    }
  }
  .sync-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--divider-color);
    .sync-switch {
      .account-name {
        font-size: 14px;
        font-weight: 600;
      }
      .account-desc {
        margin-top: 3px;
        font-size: 12px;
        color: var(--text-color-3);
      }
    }
  }
  .sync-meta {
    margin-top: 10px;
    font-size: 12px;
  }
  .library-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    .stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 14px 8px;
      border-radius: 12px;
      background-color: var(--surface-color);
      .stat-value {
        font-size: 22px;
        font-weight: 800;
        line-height: 1.2;
      }
      .stat-label {
        margin-top: 4px;
        font-size: 12px;
        color: var(--text-color-3);
      }
    }
  }
  .library-tip {
    display: block;
    margin-top: 14px;
    font-size: 12px;
    line-height: 1.6;
  }
  .manage-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 0;
  }
  .manage-info {
    min-width: 0;
    .account-name {
      font-size: 14px;
      font-weight: 600;
    }
    .account-desc {
      margin-top: 3px;
      font-size: 12px;
      color: var(--text-color-3);
    }
  }
  .manage-divider {
    margin: 10px 0 16px;
  }
  .script-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .script-list {
    margin-top: 10px;
  }
  .script-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 0;
    border-bottom: 1px solid var(--divider-color);
    &:last-of-type {
      border-bottom: none;
    }
    .script-info {
      flex: 1;
      min-width: 0;
    }
    .script-name {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
    }
    .script-version {
      font-size: 12px;
      font-weight: 500;
    }
    .script-desc {
      margin-top: 3px;
      font-size: 12px;
      color: var(--text-color-3);
    }
    .script-error {
      margin-top: 3px;
      font-size: 12px;
      color: var(--error-color);
    }
  }
  .script-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .script-tip {
    display: block;
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.6;
  }
  .import-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    .import-label {
      font-size: 13px;
      font-weight: 600;
    }
    .import-hint {
      font-size: 12px;
    }
    .import-divider {
      margin: 6px 0;
    }
    .import-file {
      font-size: 12px;
    }
  }
  @media (max-width: 700px) {
    .source-select {
      grid-template-columns: repeat(1, minmax(0, 1fr));
    }
    .account-row {
      flex-wrap: wrap;
      .account-actions {
        width: 100%;
        justify-content: flex-end;
      }
    }
    .library-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
}
</style>
