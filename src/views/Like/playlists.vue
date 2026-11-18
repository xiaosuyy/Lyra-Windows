<template>
  <div class="like-type">
    <Transition name="fade" mode="out-in">
      <CoverList :data="listData" type="playlist" :hiddenCover="settingStore.hiddenCovers.like" />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { useLibraryStore, useSettingStore } from "@/stores";
import type { CoverType } from "@/types/main";

const libraryStore = useLibraryStore();
const settingStore = useSettingStore();

// 歌单列表内容（离线音乐库，创建与收藏合并展示）
const listData = computed<CoverType[]>(() => {
  const seen = new Set<number>();
  return [...libraryStore.createdPlaylists, ...libraryStore.likedPlaylists]
    .filter((playlist) => {
      if (seen.has(playlist.id)) return false;
      seen.add(playlist.id);
      return true;
    })
    .map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      cover: playlist.cover || playlist.songs[0]?.cover || "/images/album.jpg?asset",
      description: playlist.description,
      count: playlist.songs.length,
      creator: { id: 0, name: "", avatarUrl: "" },
    }));
});
</script>

<style lang="scss" scoped>
.like-type {
  margin-top: 20px;
}
</style>
