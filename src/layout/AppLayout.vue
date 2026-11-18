<template>
  <div id="app-layout" :style="{ '--sider-width': `${siderWidth}px` }">
    <!-- 玻璃背景：当前封面柔焦，让面板有可采样的层次 -->
    <div
      v-if="settingStore.frostedGlass && !statusStore.isCustomBackground"
      class="glass-backdrop"
      :style="
        musicStore.songCover ? { backgroundImage: `url(${musicStore.songCover})` } : undefined
      "
    >
      <div class="glass-backdrop-veil" />
    </div>
    <!-- 背景图 -->
    <Transition name="fade">
      <div
        v-if="
          (statusStore.themeBackgroundMode === 'image' ||
            statusStore.themeBackgroundMode === 'video') &&
          statusStore.backgroundImageUrl
        "
        :key="statusStore.backgroundImageUrl"
        class="background-container"
      >
        <div
          v-if="statusStore.themeBackgroundMode === 'image'"
          class="background-image"
          :style="{
            backgroundImage: `url(${statusStore.backgroundImageUrl})`,
            transform: `scale(${statusStore.backgroundConfig.scale})`,
            filter: `blur(${statusStore.backgroundConfig.blur}px)`,
          }"
        />
        <video
          v-else-if="statusStore.themeBackgroundMode === 'video'"
          class="background-image"
          :src="statusStore.backgroundImageUrl"
          autoplay
          loop
          muted
          :style="{
            objectFit: 'cover',
            transform: `scale(${statusStore.backgroundConfig.scale})`,
            filter: `blur(${statusStore.backgroundConfig.blur}px)`,
          }"
        />
        <div
          class="background-mask"
          :style="{
            backgroundColor: `rgba(0, 0, 0, ${statusStore.backgroundConfig.maskOpacity / 100})`,
          }"
        />
      </div>
    </Transition>
    <!-- 主框架 -->
    <n-layout
      id="main"
      :class="{
        'show-player': musicStore.isHasPlayer && statusStore.showPlayBar,
        'show-full-player': statusStore.showFullPlayer,
      }"
      has-sider
    >
      <!-- 侧边栏 -->
      <n-layout-sider
        v-if="isDesktop"
        id="main-sider"
        :style="{
          height: '100vh',
        }"
        :content-style="{
          overflow: 'hidden',
          height: '100%',
          padding: '0',
        }"
        :native-scrollbar="false"
        :collapsed="statusStore.menuCollapsed"
        :collapsed-width="64"
        :width="240"
        collapse-mode="width"
        show-trigger="bar"
        bordered
        @collapse="statusStore.menuCollapsed = true"
        @expand="statusStore.menuCollapsed = false"
      >
        <Sider />
      </n-layout-sider>
      <n-layout id="main-layout">
        <!-- 导航栏 -->
        <Nav id="main-header" />
        <n-layout
          ref="contentRef"
          id="main-content"
          :native-scrollbar="false"
          :style="{
            '--layout-height': contentHeight,
          }"
          :content-style="{
            display: 'grid',
            gridTemplateRows: '1fr',
            minHeight: '100%',
            padding: isMobile ? '0 16px' : '0 24px',
            paddingTop: '70px',
            paddingBottom: musicStore.isHasPlayer && statusStore.showPlayBar ? '104px' : '0',
          }"
          position="absolute"
          embedded
        >
          <!-- 路由页面 -->
          <RouterView v-slot="{ Component }">
            <Transition :name="`router-${settingStore.routeAnimation}`" mode="out-in">
              <KeepAlive v-if="settingStore.useKeepAlive" :max="20" :exclude="['layout']">
                <component :is="Component" class="router-view" />
              </KeepAlive>
              <component v-else :is="Component" class="router-view" />
            </Transition>
          </RouterView>
          <!-- 回顶 -->
          <n-back-top :right="40" :bottom="120">
            <SvgIcon :size="22" name="Up" />
          </n-back-top>
        </n-layout>
      </n-layout>
    </n-layout>
    <!-- 播放列表 -->
    <SongPlayList />
    <!-- 全局播放器 -->
    <MainPlayer />
    <!-- 全屏播放器 -->
    <PlayerProvider>
      <FullPlayer />
    </PlayerProvider>
  </div>
</template>

<script setup lang="ts">
import { useMusicStore, useStatusStore, useSettingStore, useDataStore } from "@/stores";
import { useBlobURLManager } from "@/core/resource/BlobURLManager";
import { isElectron } from "@/utils/env";
import { useMobile } from "@/composables/useMobile";
import { useInit } from "@/composables/useInit";
import { useOsTheme } from "naive-ui";

const musicStore = useMusicStore();
const statusStore = useStatusStore();
const settingStore = useSettingStore();
const dataStore = useDataStore();

const blobURLManager = useBlobURLManager();

const { isDesktop, isMobile } = useMobile();

// 播放栏按内容区居中：侧边栏展开 240，收起 64，小窗口不渲染侧边栏
const siderWidth = computed(() => (isDesktop.value ? (statusStore.menuCollapsed ? 64 : 240) : 0));

// 主内容
const contentRef = ref<HTMLElement | null>(null);

// 主内容高度
const { height: contentHeight } = useElementSize(contentRef);

// 加载背景图
const loadBackgroundImage = async () => {
  if (statusStore.backgroundImageUrl) return;
  if (statusStore.themeBackgroundMode === "image" || statusStore.themeBackgroundMode === "video") {
    const blob = await dataStore.getBackgroundImage();
    if (blob) {
      const arrayBuffer = await blob.arrayBuffer();
      statusStore.backgroundImageUrl = blobURLManager.createBlobURL(
        arrayBuffer,
        blob.type,
        "background-image",
      );
    }
  }
};

watchEffect(() => {
  statusStore.mainContentHeight = contentHeight.value;
});

// 磨砂玻璃：类名与强度变量挂到根节点，保证弹窗等传送层同样生效
const osTheme = useOsTheme();
const isDarkTheme = computed(
  () =>
    statusStore.isCustomBackground ||
    settingStore.themeMode === "dark" ||
    (settingStore.themeMode === "auto" && osTheme.value === "dark"),
);

watchEffect(() => {
  const root = document.documentElement;
  const enabled = settingStore.frostedGlass;
  // 与手机端 EnhancedAdvancedBlurPreference 对齐：12dp ~ 64dp，默认 28dp
  const blur = Math.min(64, Math.max(12, Math.round(settingStore.frostedGlassBlur)));
  const progress = (blur - 12) / 52;
  // 手机端 glassTintAlpha：模糊越低越清透，越高越磨砂
  const tintScale = 0.25 + 0.75 * progress;
  const alpha = (base: number) => (base * tintScale).toFixed(3);
  const dark = isDarkTheme.value;

  root.classList.toggle("frosted-glass", enabled);
  root.style.setProperty("--frost-blur", `${blur}px`);
  root.style.setProperty("--glass-side-alpha", alpha(0.7));
  root.style.setProperty("--glass-bar-alpha", alpha(0.56));
  root.style.setProperty("--glass-dock-alpha", alpha(0.6));
  root.style.setProperty("--glass-card-alpha", alpha(0.62));
  root.style.setProperty("--glass-modal-alpha", alpha(0.94));
  root.style.setProperty("--glass-pop-alpha", alpha(0.94));
  root.style.setProperty(
    "--glass-sheen",
    dark ? "rgba(255, 255, 255, 0.06)" : "rgba(255, 255, 255, 0.55)",
  );
  root.style.setProperty(
    "--glass-smoke",
    dark ? "rgba(255, 255, 255, 0.03)" : "rgba(15, 23, 42, 0.04)",
  );
  root.style.setProperty(
    "--glass-glow",
    dark ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.05)",
  );
  root.style.setProperty(
    "--glass-edge",
    dark ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.12)",
  );
  root.style.setProperty(
    "--glass-border",
    dark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.08)",
  );
  root.style.setProperty(
    "--glass-highlight",
    dark ? "rgba(255, 255, 255, 0.06)" : "rgba(255, 255, 255, 0.6)",
  );
  root.style.setProperty(
    "--glass-shadow",
    dark
      ? "0 14px 40px rgba(0, 0, 0, 0.5)"
      : "0 12px 32px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.05)",
  );
});

// 初始化
useInit();

onMounted(() => {
  loadBackgroundImage();
  if (!isElectron) {
    window.addEventListener("beforeunload", (event) => {
      event.preventDefault();
      // 释放所有 blob URL
      blobURLManager.revokeAllBlobURLs();
      event.returnValue = "";
    });
  }
});
</script>

<style lang="scss" scoped>
#app-layout {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.glass-backdrop {
  position: fixed;
  inset: -12%;
  z-index: -1;
  pointer-events: none;
  background-image:
    radial-gradient(80% 70% at 12% -10%, var(--glass-glow), transparent 70%),
    radial-gradient(70% 60% at 100% 0%, var(--glass-glow), transparent 65%);
  background-size: cover;
  background-position: center;
  filter: blur(90px) saturate(0.55);
  .glass-backdrop-veil {
    position: absolute;
    inset: 0;
    background-color: rgba(var(--background), 0.62);
  }
}

.background-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
  .background-image {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    transform-origin: center center;
  }
  .background-mask {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
}

#main {
  flex: 1;
  height: 100%;
  transition:
    transform 0.3s var(--n-bezier),
    opacity 0.3s var(--n-bezier);
  #main-header {
    position: relative;
    z-index: 3;
  }
  #main-layout {
    // background-color: rgba(var(--background), 0.58);
    background-color: rgba(var(--background));
  }
  #main-content {
    top: 70px;
    bottom: 0;
    background-color: transparent;
    .router-view {
      position: relative;
      height: 100%;
      min-width: 0;
      &.n-result {
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
    }
  }
  &.show-full-player {
    opacity: 0;
    transform: scale(0.9);
    #main-header {
      -webkit-app-region: no-drag;
    }
  }
}
</style>
