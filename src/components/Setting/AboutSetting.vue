<template>
  <div class="about-setting">
    <n-h3 prefix="bar">关于软件</n-h3>

    <n-card class="set-card hero-card" :bordered="false">
      <div class="hero">
        <Logo :size="64" />
        <div class="hero-copy">
          <div class="hero-name">
            Lyra
            <n-tag v-if="statusStore.isDeveloperMode" size="small" type="warning" round>DEV</n-tag>
          </div>
          <div class="hero-desc">Lyra • GPLv3 • 由你可爱地驱动</div>
        </div>
      </div>
    </n-card>

    <n-card class="set-card list-card" :bordered="false">
      <button type="button" class="about-row" @click="handleVersionClick">
        <span class="row-icon"><SvgIcon name="Update" :size="22" /></span>
        <span class="row-copy">
          <span class="row-title">版本</span>
          <span class="row-value">{{ displayVersion }}</span>
        </span>
        <SvgIcon class="row-action" name="Copy" :size="18" />
      </button>
      <button v-if="isElectron" type="button" class="about-row" @click="handleCheckUpdate">
        <span class="row-icon"><SvgIcon name="Refresh" :size="22" /></span>
        <span class="row-copy">
          <span class="row-title">检查更新</span>
          <span class="row-value">{{ checking ? "正在检查更新…" : "获取最新版本" }}</span>
        </span>
        <SvgIcon class="row-action" name="Right" :size="18" />
      </button>
      <div v-if="isElectron" class="about-row source-row">
        <span class="row-icon"><SvgIcon name="Cloud" :size="22" /></span>
        <span class="row-copy">
          <span class="row-title">更新访问源</span>
          <span class="row-value">GitHub 直连或使用 ghproxy Cloudflare 节点加速下载</span>
        </span>
        <n-select
          v-model:value="settingStore.updateSource"
          class="source-select"
          :options="updateSourceOptions"
          :consistent-menu-width="false"
        />
      </div>
      <button v-if="isElectron" type="button" class="about-row" @click="handleOpenLog">
        <span class="row-icon"><SvgIcon name="Code" :size="22" /></span>
        <span class="row-copy">
          <span class="row-title">运行日志</span>
          <span class="row-value">打开日志文件</span>
        </span>
        <SvgIcon class="row-action" name="Right" :size="18" />
      </button>
    </n-card>

    <div class="about-footer">Lyra Music Player</div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore, useStatusStore } from "@/stores";
import type { UpdateSource } from "@/types/main";
import { isElectron } from "@/utils/env";
import { copyData } from "@/utils/helper";
import { getDisplayVersion } from "@/utils/version";
import Logo from "@/components/Layout/Logo.vue";

const statusStore = useStatusStore();
const settingStore = useSettingStore();

const displayVersion = getDisplayVersion();
const checking = ref(false);

const updateSourceOptions: { label: string; value: UpdateSource }[] = [
  { label: "GitHub", value: "github" },
  { label: "ghproxy", value: "ghproxy" },
];

// 打开日志文件
const handleOpenLog = () => {
  window.electron.ipcRenderer.send("open-log-file");
};

// 检查更新
const handleCheckUpdate = () => {
  if (checking.value) return;
  checking.value = true;
  window.electron.ipcRenderer.send("check-update", true, settingStore.updateSource);
  window.setTimeout(() => (checking.value = false), 3000);
};

// 开发者模式点击次数
const developerModeClickCount = ref(0);

// 版本行：点击复制版本号，连续点击开启开发者模式
const triggerVersionClick = useThrottleFn(() => {
  developerModeClickCount.value++;
  if (developerModeClickCount.value >= 5 && developerModeClickCount.value < 8) {
    const action = statusStore.developerMode ? "关闭" : "开启";
    window.$message.info(`再点击${8 - developerModeClickCount.value}次以${action}开发者模式`);
  } else if (developerModeClickCount.value >= 8) {
    developerModeClickCount.value = 0;
    statusStore.developerMode = !statusStore.developerMode;
    if (statusStore.developerMode) {
      window.$message.warning("开发者模式已开启，请谨慎使用！");
    } else {
      window.$message.success("开发者模式已关闭");
    }
  }
}, 100);

const handleVersionClick = () => {
  copyData(displayVersion);
  triggerVersionClick();
};
</script>

<style lang="scss" scoped>
.about-setting {
  padding-bottom: 20px;
  .set-card {
    margin-bottom: 12px;
    border-radius: 10px;
    background-color: var(--surface-container-hex);
    :deep(.n-card__content) {
      padding: 18px;
    }
  }
  .hero-card :deep(.n-card__content) {
    padding: 22px 18px;
  }
  .hero {
    display: flex;
    align-items: center;
    gap: 16px;
    .hero-copy {
      min-width: 0;
    }
    .hero-name {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.3px;
    }
    .hero-desc {
      margin-top: 4px;
      font-size: 13px;
      color: var(--text-color-3);
    }
  }
  .list-card :deep(.n-card__content) {
    padding: 4px 18px;
  }
  .about-row {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 14px 0;
    border: none;
    border-bottom: 1px solid var(--divider-color);
    background: transparent;
    text-align: left;
    cursor: pointer;
    &:last-child {
      border-bottom: none;
    }
    .row-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background-color: var(--surface-color);
      color: var(--text-color-1);
      flex-shrink: 0;
    }
    .row-copy {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .row-title {
      font-size: 14px;
      font-weight: 600;
    }
    .row-value {
      margin-top: 2px;
      font-size: 12px;
      color: var(--text-color-3);
    }
    .row-action {
      color: var(--text-color-3);
      flex-shrink: 0;
      transition: color 0.2s ease;
    }
    &:hover .row-action {
      color: var(--text-color-1);
    }
  }
  .source-row {
    cursor: default;
  }
  .source-select {
    width: 128px;
    flex-shrink: 0;
  }
  .about-footer {
    margin-top: 18px;
    text-align: center;
    font-size: 12px;
    color: var(--text-color-3);
  }
}
</style>
