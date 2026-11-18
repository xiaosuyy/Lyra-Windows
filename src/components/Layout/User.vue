<template>
  <n-popover
    :show="menuShow"
    trigger="manual"
    placement="bottom-end"
    :style="{ padding: '0' }"
    @clickoutside="menuShow = false"
  >
    <template #trigger>
      <button
        type="button"
        class="avatar-btn"
        :aria-label="accountStore.configured ? '账号' : 'WebDAV 登录'"
        @click="handleAvatarClick"
      >
        <img
          :src="accountStore.profileAvatarUrl || avatarPlaceholder"
          alt="账号头像"
          draggable="false"
        />
      </button>
    </template>
    <div class="account-menu">
      <div class="profile">
        <button
          type="button"
          class="avatar-edit-btn"
          :disabled="avatarBusy"
          :title="accountStore.configured ? '点击更换头像' : '登录后可更换头像'"
          @click="handleAvatarPick"
        >
          <img
            class="avatar"
            :src="accountStore.profileAvatarUrl || avatarPlaceholder"
            alt="账号头像"
            draggable="false"
          />
          <span class="avatar-mask">
            <SvgIcon name="Edit" :size="14" />
          </span>
        </button>
        <input
          ref="avatarInput"
          class="avatar-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          @change="handleAvatarChange"
        />
        <div class="info">
          <n-text class="name text-hidden">
            {{
              accountStore.profileName ||
              (accountStore.configured ? accountStore.displayName : "未登录")
            }}
          </n-text>
          <n-text class="server text-hidden" :depth="3">
            {{ accountStore.configured ? accountStore.serverUrl : "使用 WebDAV 登录 Lyra" }}
          </n-text>
        </div>
      </div>
      <n-divider />
      <template v-if="accountStore.configured">
        <div v-if="accountStore.basePath" class="meta-row">
          <n-text :depth="3">初始路径</n-text>
          <n-text class="meta-value text-hidden">{{ accountStore.basePath }}</n-text>
        </div>
        <div class="menu-item" @click="handleSyncNow">
          <SvgIcon name="Refresh" :depth="3" :class="{ spinning: libraryStore.syncing }" />
          {{ libraryStore.syncing ? "正在同步…" : "立即同步" }}
        </div>
        <div class="menu-item" @click="handleReconfigure">
          <SvgIcon name="CloudLockOpen" :depth="3" />
          重新配置 WebDAV
        </div>
        <div class="menu-item danger" @click="handleLogout">
          <SvgIcon name="Power" :depth="3" />
          退出登录
        </div>
      </template>
      <template v-else>
        <n-button block type="primary" strong @click="handleLogin">WebDAV 登录</n-button>
        <n-text class="tip" :depth="3">登录后可在多设备间同步账号数据</n-text>
      </template>
    </div>
  </n-popover>
</template>

<script setup lang="ts">
import { useAccountStore, useLibraryStore } from "@/stores";
import { openWebDavLogin } from "@/utils/modal";
import avatarPlaceholder from "@/assets/lyra-avatar.png";

const accountStore = useAccountStore();
const libraryStore = useLibraryStore();

// 菜单展示
const menuShow = ref(false);

// 头像选择
const avatarInput = ref<HTMLInputElement>();
const avatarBusy = ref(false);

// 点击头像
const handleAvatarClick = () => {
  if (accountStore.configured) {
    menuShow.value = !menuShow.value;
  } else {
    handleLogin();
  }
};

// 打开登录弹窗
const handleLogin = () => {
  menuShow.value = false;
  openWebDavLogin(() => {
    accountStore.load();
  });
};

// 立即同步
const handleSyncNow = async () => {
  if (libraryStore.syncing) return;
  await libraryStore.syncNow();
};

// 点击详情内头像：选择本地图片
const handleAvatarPick = () => {
  if (!accountStore.configured || avatarBusy.value) return;
  avatarInput.value?.click();
};

/** 压缩为 256px 以内的 JPEG base64（与手机端头像格式一致） */
const readAvatarBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 256 / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("头像处理失败"));
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.85).split(",")[1] || "");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    image.src = url;
  });

// 更换头像并同步到 WebDAV
const handleAvatarChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    window.$message.warning("请选择图片文件");
    return;
  }
  avatarBusy.value = true;
  try {
    const avatarBase64 = await readAvatarBase64(file);
    await accountStore.updateProfile({ avatarBase64 });
    window.$message.success("头像已更新");
    libraryStore.syncNow(true).catch(() => undefined);
  } catch (error) {
    window.$message.error((error as Error).message || "头像更新失败");
  } finally {
    avatarBusy.value = false;
  }
};

// 重新配置
const handleReconfigure = () => {
  menuShow.value = false;
  openWebDavLogin(() => {
    accountStore.load();
  });
};

// 退出登录
const handleLogout = () => {
  menuShow.value = false;
  window.$dialog.warning({
    title: "退出登录",
    content: "确认退出当前 WebDAV 账号？本地配置将被清除。",
    positiveText: "退出登录",
    negativeText: "取消",
    onPositiveClick: async () => {
      await accountStore.logout();
      window.$message.success("已退出登录");
    },
  });
};

onMounted(() => {
  accountStore.load();
});
</script>

<style lang="scss" scoped>
.avatar-btn {
  position: relative;
  width: 36px;
  height: 36px;
  min-width: 36px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  outline: none;
  -webkit-app-region: no-drag;
  transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  img {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    user-select: none;
  }
  .online-dot {
    display: none;
  }
  &:hover {
    transform: scale(1.08);
  }
  &:active {
    transform: scale(0.96);
  }
  &:focus-visible {
    box-shadow: 0 0 0 2px rgba(var(--primary), 0.4);
  }
}
.account-menu {
  width: 240px;
  padding: 14px;
  .profile {
    display: flex;
    align-items: center;
    .avatar-edit-btn {
      position: relative;
      width: 44px;
      height: 44px;
      flex-shrink: 0;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: transparent;
      cursor: pointer;
      overflow: hidden;
      &:disabled {
        cursor: default;
      }
      .avatar {
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        object-fit: cover;
      }
      .avatar-mask {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.45);
        color: #fff;
        opacity: 0;
        transition: opacity 0.2s;
      }
      &:hover .avatar-mask,
      &:focus-visible .avatar-mask {
        opacity: 1;
      }
    }
    .avatar-input {
      display: none;
    }
    .info {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin-left: 10px;
      min-width: 0;
      .name {
        font-size: 14px;
        font-weight: 600;
      }
      .server {
        font-size: 12px;
      }
    }
  }
  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    margin-bottom: 8px;
    .meta-value {
      max-width: 140px;
    }
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    border-radius: 8px;
    font-size: 13px;
    cursor: pointer;
    transition: background-color 0.2s;
    &:hover {
      background: rgba(var(--primary), 0.08);
    }
    .spinning {
      animation: sync-spin 1s linear infinite;
    }
    &.danger:hover {
      background: rgba(232, 65, 66, 0.1);
      color: #e84142;
    }
  }
  .tip {
    display: block;
    margin-top: 10px;
    font-size: 12px;
    text-align: center;
  }
  .n-divider {
    margin: 12px 0;
  }
}
@keyframes sync-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
