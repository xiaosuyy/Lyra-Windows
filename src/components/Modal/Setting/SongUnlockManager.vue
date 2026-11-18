<template>
  <div class="song-unlock-manager">
    <n-alert title="音乐解锁" type="info">
      音源与 Lyra 手机端一致，按顺序尝试；拖动可调整优先级
    </n-alert>
    <div ref="sortableRef" class="sortable-list">
      <n-card
        v-for="item in settingStore.songUnlockServer"
        :key="item.key"
        :content-style="{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '16px',
        }"
        class="sortable-item"
      >
        <SvgIcon :depth="3" name="Menu" />
        <div class="source-info">
          <n-text class="name">{{ sourceMeta[item.key]?.name ?? item.key }}</n-text>
          <n-text class="desc" :depth="3">{{ sourceMeta[item.key]?.desc }}</n-text>
        </div>
        <n-switch v-model:value="item.enabled" :round="false" />
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSettingStore } from "@/stores";
import { SongUnlockServer } from "@/core/player/SongManager";
import { useSortable } from "@vueuse/integrations/useSortable";
import type { Options } from "sortablejs";

const settingStore = useSettingStore();

// 音源信息
const sourceMeta: Record<string, { name: string; desc: string }> = {
  [SongUnlockServer.NETEASE]: { name: "网易云音乐", desc: "原生音源与备用直链" },
  [SongUnlockServer.TENCENT]: { name: "QQ 音乐", desc: "同名歌曲匹配后取链" },
  [SongUnlockServer.KUGOU]: { name: "酷狗音乐", desc: "同名歌曲匹配后取链" },
  [SongUnlockServer.KUWO]: { name: "酷我音乐", desc: "同名歌曲匹配后取链" },
  [SongUnlockServer.MIGU]: { name: "咪咕音乐", desc: "同名歌曲匹配后取链" },
  [SongUnlockServer.BILIBILI]: { name: "哔哩哔哩", desc: "视频音轨（本地代理播放）" },
};

const sortableRef = ref<HTMLElement | null>(null);

// 拖拽
useSortable(sortableRef, settingStore.songUnlockServer, {
  animation: 150,
  handle: ".n-icon",
} as Options);
</script>

<style scoped lang="scss">
.sortable-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  .sortable-item {
    border-radius: 8px;
    .n-icon {
      font-size: 16px;
      cursor: move;
    }
    .name {
      font-size: 15px;
      line-height: normal;
    }
    .source-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
      .desc {
        font-size: 12px;
      }
    }
    .n-switch {
      margin-left: auto;
    }
  }
}
</style>
