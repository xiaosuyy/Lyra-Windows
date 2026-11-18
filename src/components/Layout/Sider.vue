<!-- 侧边栏 -->
<template>
  <div class="sider-all">
    <!-- Logo -->
    <div class="logo" @click="router.push('/')">
      <Logo />
    </div>
    <n-scrollbar
      :style="{
        maxHeight: `calc(100vh - ${musicStore.isHasPlayer && statusStore.showPlayBar ? 150 : 70}px)`,
      }"
    >
      <Menu />
    </n-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { useStatusStore, useMusicStore } from "@/stores";

const router = useRouter();
const musicStore = useMusicStore();
const statusStore = useStatusStore();
</script>

<style lang="scss" scoped>
.sider-all {
  display: flex;
  flex-direction: column;
  .logo {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 70px;
    padding: 0 1rem;
    transition: transform 0.3s;
    cursor: pointer;
    &:hover {
      transform: scale(1.05);
    }
    &:active {
      transform: scale(1);
    }
  }
}
</style>
