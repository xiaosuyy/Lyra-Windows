<!-- QQ 音乐歌单 / 榜单 / 每日推荐 -->
<template>
  <div class="tencent-page">
    <!-- 榜单广场 -->
    <template v-if="kind === 'toplists'">
      <div class="page-head simple">
        <n-tag round type="primary" :bordered="false">QQ音乐</n-tag>
        <n-h1>排行榜</n-h1>
        <n-text depth="3">发现当下最热门的音乐</n-text>
      </div>
      <div v-if="loading" class="toplist-grid">
        <div v-for="i in 8" :key="i" class="toplist-card">
          <n-skeleton height="150px" :style="{ borderRadius: '18px' }" />
          <n-skeleton text style="margin-top: 12px; width: 70%" />
        </div>
      </div>
      <div v-else-if="toplists.length > 0" class="toplist-grid">
        <div
          v-for="item in toplists"
          :key="item.id"
          class="toplist-card"
          @click="openToplist(item)"
        >
          <div class="toplist-cover">
            <s-image
              :src="item.cover"
              default-src="/images/album.jpg?asset"
              class="cover-img"
              once
            />
            <div class="toplist-play"><SvgIcon name="Play" :size="22" /></div>
          </div>
          <n-text class="toplist-name text-hidden">{{ item.name }}</n-text>
          <n-text v-if="item.count" class="toplist-sub" depth="3">{{ item.count }} 首</n-text>
        </div>
      </div>
      <n-empty v-else description="暂无榜单数据" size="large" style="margin-top: 60px" />
    </template>

    <!-- 歌单 / 榜单详情 -->
    <template v-else>
      <div class="page-head">
        <div class="head-cover">
          <s-image :src="cover" default-src="/images/album.jpg?asset" class="cover-img" once />
        </div>
        <div class="head-meta">
          <n-tag round type="primary" :bordered="false">QQ音乐</n-tag>
          <n-h1>{{ title }}</n-h1>
          <n-text class="subtitle" depth="3">{{ subtitle }}</n-text>
          <n-flex class="actions" align="center" :size="14">
            <n-button
              :focusable="false"
              type="primary"
              strong
              round
              :disabled="songs.length === 0"
              @click="playAll"
            >
              <template #icon>
                <SvgIcon name="Play" />
              </template>
              播放全部
            </n-button>
            <n-tooltip v-if="canFavorite" :show-arrow="false">
              <template #trigger>
                <n-button
                  :focusable="false"
                  strong
                  secondary
                  circle
                  :loading="favoriteUpdating"
                  @click="toggleFavorite"
                >
                  <template #icon>
                    <SvgIcon :name="isFavoritePlaylist ? 'Favorite' : 'FavoriteBorder'" />
                  </template>
                </n-button>
              </template>
              {{ isFavoritePlaylist ? "取消收藏" : "收藏歌单" }}
            </n-tooltip>
            <n-tag round :bordered="false">共 {{ songs.length }} 首</n-tag>
          </n-flex>
        </div>
      </div>
      <SongList :data="songs" :loading="true" height="auto" disabledSort />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { CoverType, SongType } from "@/types/main";
import { qqMusicHome, qqMusicPlaylist, qqMusicToplist } from "@/api/qqmusic";
import { formatQQPlaylists, formatQQSongs } from "@/utils/qq";
import { usePlayerController } from "@/core/player/PlayerController";
import { useLibraryStore } from "@/stores";

const router = useRouter();
const player = usePlayerController();
const libraryStore = useLibraryStore();

const loading = ref<boolean>(true);
const songs = ref<SongType[]>([]);
const toplists = ref<CoverType[]>([]);

const query = computed(() => router.currentRoute.value.query);
const kind = computed(() => String(query.value.kind || "playlist"));
const id = computed(() => Number(query.value.id || 0));
const cover = computed(() => String(query.value.cover || ""));
const title = computed(() => {
  if (query.value.name) return String(query.value.name);
  const names: Record<string, string> = {
    daily: "每日推荐",
    roam: "私人漫游",
    new: "新歌速递",
    toplist: "QQ音乐榜单",
    playlist: "QQ音乐歌单",
  };
  return names[kind.value] || "QQ音乐";
});
const subtitle = computed(() => {
  const tips: Record<string, string> = {
    daily: "根据你的音乐口味生成，每日更新",
    roam: "为你挑选的无限好音乐",
    new: "最近上架的新歌",
    toplist: "实时更新的热门榜单",
    playlist: "来自 QQ 音乐的推荐歌单",
  };
  return tips[kind.value] || "来自 QQ 音乐";
});

const getSongs = async (): Promise<SongType[]> => {
  switch (kind.value) {
    case "daily": {
      const result = await qqMusicHome("daily", 60);
      return formatQQSongs(result?.data?.daily);
    }
    case "roam": {
      const result = await qqMusicHome("roam", 60);
      return formatQQSongs(result?.data?.roam);
    }
    case "new": {
      const result = await qqMusicHome("new", 60);
      return formatQQSongs(result?.data?.newSongs);
    }
    case "toplist": {
      if (!id.value) return [];
      const result = await qqMusicToplist(id.value, 100);
      return formatQQSongs(result?.data?.songs);
    }
    default: {
      if (!id.value) return [];
      const result = await qqMusicPlaylist(id.value, 200);
      return formatQQSongs(result?.data?.songs);
    }
  }
};

const loadData = async () => {
  loading.value = true;
  songs.value = [];
  toplists.value = [];
  try {
    if (kind.value === "toplists") {
      const result = await qqMusicHome("toplists", 24);
      toplists.value = formatQQPlaylists(result?.data?.toplists);
    } else {
      songs.value = await getSongs();
    }
  } catch (error) {
    console.error("获取 QQ 音乐内容失败:", error);
    window.$message.error("获取 QQ 音乐内容失败，请稍后重试");
  } finally {
    loading.value = false;
  }
};

const openToplist = (item: CoverType) => {
  router.push({
    name: "tencent-playlist",
    query: { kind: "toplist", id: item.id, name: item.name, cover: item.cover },
  });
};

const playAll = () => {
  if (!songs.value.length) return;
  player.updatePlayList(songs.value, undefined, 0);
};

// 仅歌单 / 榜单支持收藏
const canFavorite = computed(
  () => (kind.value === "playlist" || kind.value === "toplist") && id.value > 0,
);

// 是否已收藏到本地音乐库
const isFavoritePlaylist = computed(
  () => canFavorite.value && libraryStore.isFavoritePlaylist(id.value, "tencent"),
);

// 收藏操作进行中
const favoriteUpdating = ref(false);

// 收藏 / 取消收藏歌单
const toggleFavorite = async () => {
  if (!canFavorite.value || favoriteUpdating.value) return;
  favoriteUpdating.value = true;
  try {
    if (isFavoritePlaylist.value) {
      await libraryStore.removeFavoritePlaylist(id.value, "tencent");
      window.$message.success("已取消收藏");
    } else {
      await libraryStore.addFavoritePlaylist({
        remoteId: id.value,
        source: "tencent",
        name: title.value,
        cover: cover.value || songs.value[0]?.cover,
        songs: songs.value,
      });
      window.$message.success("已收藏歌单");
    }
  } finally {
    favoriteUpdating.value = false;
  }
};

watch(
  () => [kind.value, id.value],
  () => loadData(),
);

onMounted(loadData);
</script>

<style lang="scss" scoped>
.tencent-page {
  width: 100%;
  padding-bottom: 40px;
  .page-head {
    display: flex;
    align-items: flex-end;
    gap: 28px;
    margin: 12px 0 28px;
    &.simple {
      display: block;
      .n-h1 {
        margin: 12px 0 4px;
        font-size: 34px;
        font-weight: 800;
      }
    }
    .head-cover {
      width: 190px;
      height: 190px;
      flex-shrink: 0;
      border-radius: 22px;
      overflow: hidden;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
      .cover-img {
        width: 100%;
        height: 100%;
        :deep(img) {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      }
    }
    .head-meta {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
      min-width: 0;
      .n-h1 {
        margin: 0;
        font-size: 36px;
        font-weight: 800;
        line-height: 1.2;
        word-break: break-word;
      }
      .subtitle {
        font-size: 14px;
      }
      .actions {
        margin-top: 6px;
      }
    }
  }
  .toplist-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 20px;
    .toplist-card {
      cursor: pointer;
      .toplist-cover {
        position: relative;
        width: 100%;
        aspect-ratio: 1 / 1;
        border-radius: 18px;
        overflow: hidden;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
        transition:
          transform 0.3s,
          box-shadow 0.3s;
        .cover-img {
          width: 100%;
          height: 100%;
          :deep(img) {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
        }
        .toplist-play {
          position: absolute;
          right: 10px;
          bottom: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          color: #fff;
          background: rgba(255, 255, 255, 0.24);
          backdrop-filter: blur(6px);
          opacity: 0;
          transform: translateY(6px);
          transition:
            opacity 0.25s,
            transform 0.25s;
        }
      }
      .toplist-name {
        display: block;
        margin-top: 10px;
        font-size: 15px;
        font-weight: 600;
      }
      .toplist-sub {
        display: block;
        margin-top: 3px;
        font-size: 12px;
      }
      &:hover {
        .toplist-cover {
          transform: translateY(-4px);
          box-shadow: 0 16px 30px rgba(0, 0, 0, 0.18);
        }
        .toplist-play {
          opacity: 1;
          transform: translateY(0);
        }
      }
    }
  }
  @media (max-width: 700px) {
    .page-head {
      flex-direction: column;
      align-items: flex-start;
      .head-cover {
        width: 140px;
        height: 140px;
      }
    }
  }
}
</style>
