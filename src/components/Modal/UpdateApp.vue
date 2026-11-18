<template>
  <div class="update-app">
    <n-flex :size="10" class="version" align="center">
      <n-tag type="primary" round>
        {{ packageJson?.version || "v0.0.0" }}
      </n-tag>
      <SvgIcon name="Right" :size="16" />
      <n-tag type="warning" round>
        {{ data.version || "v0.0.0" }}
      </n-tag>
      <n-tag v-if="data.prerelease" type="error" round> 测试版 </n-tag>
      <span v-if="fileSize" class="size">{{ fileSize }}</span>
    </n-flex>
    <!-- 测试版警告 -->
    <n-alert v-if="data.prerelease" type="warning" :bordered="false" class="prerelease-warning">
      当前更新为测试版本，可能包含未完成的功能或已知问题，请谨慎更新
    </n-alert>
    <n-scrollbar class="changelog-scroll">
      <div class="changelog markdown-body" v-html="renderedNotes" @click="handleMarkdownClick" />
    </n-scrollbar>
    <n-flex class="menu" justify="center" :size="14">
      <n-button strong secondary @click="emit('close')"> 稍后更新 </n-button>
      <!-- 已下载完成：显示立即安装 -->
      <n-button v-if="statusStore.updateDownloaded" type="success" strong @click="doInstall">
        立即安装
      </n-button>
      <!-- 下载中：显示进度 -->
      <n-button
        v-else
        :loading="statusStore.updateDownloading"
        type="primary"
        strong
        @click="startDownload"
      >
        {{
          statusStore.updateDownloading
            ? `下载中 ${statusStore.updateDownloadProgress}%`
            : "立即更新"
        }}
      </n-button>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import type { UpdateInfoType } from "@/types/main";
import { useSettingStore, useStatusStore } from "@/stores";
import { marked } from "marked";
import packageJson from "@/../package.json";

const props = defineProps<{ data: UpdateInfoType }>();

const emit = defineEmits<{ close: [] }>();

const statusStore = useStatusStore();
const settingStore = useSettingStore();

const renderedNotes = computed(() => {
  const notes = props.data?.releaseNotes?.trim() || "暂无更新日志";
  return marked.parse(notes) as string;
});

const fileSize = computed(() => {
  const bytes = props.data?.sizeBytes || 0;
  if (bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
});

// 处理 markdown 中的链接点击
const handleMarkdownClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  // 从事件目标向上遍历，查找最近的 <a> 标签
  const anchor = target.closest("a");
  if (anchor?.href) {
    event.preventDefault();
    window.open(anchor.href, "_blank");
  }
};

// 开始下载更新
const startDownload = () => {
  if (statusStore.updateDownloading) return;
  window.electron.ipcRenderer.send("start-download-update", settingStore.updateSource);
};

// 安装更新
const doInstall = () => {
  window.electron.ipcRenderer.send("install-update");
};
</script>

<style lang="scss" scoped>
.update-app {
  .version {
    margin-bottom: 16px;

    .size {
      margin-left: auto;
      font-size: 13px;
      color: var(--text-color-3);
    }
  }

  .changelog-scroll {
    max-height: 55vh;
    margin-bottom: 20px;
    :deep(.n-scrollbar-content) {
      padding-right: 12px;
    }
  }

  .changelog {
    margin-top: 0 !important;
    font-size: 14px;
    line-height: 1.7;
    word-break: break-word;

    :deep(h1),
    :deep(h2),
    :deep(h3) {
      margin: 16px 0 8px;
      font-size: 16px;
    }

    :deep(ul),
    :deep(ol) {
      padding-left: 1.5em;
    }
  }

  .menu {
    margin-top: 4px;

    .n-button {
      min-width: 120px;
    }
  }

  .prerelease-warning {
    margin-bottom: 12px;
  }
}
</style>
