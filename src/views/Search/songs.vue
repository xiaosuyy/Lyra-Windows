<template>
  <div class="search-type">
    <Transition name="fade" mode="out-in">
      <SongList
        v-if="!loaded || filteredSongs.length > 0"
        :data="filteredSongs"
        :loading="loading"
        doubleClickAction="add"
        loadMore
        disabledSort
        @reachBottom="reachBottom"
      />
      <n-empty
        v-else
        :description="`很抱歉，未能找到与 ${keyword} 相关的任何歌曲`"
        style="margin-top: 60px"
        size="large"
      >
        <template #icon>
          <SvgIcon name="SearchOff" />
        </template>
      </n-empty>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import type { SongType } from "@/types/main";
import type { SearchChannelOption } from "@/composables/useSearchChannelFilter";
import { qqMusicSearch } from "@/api/qqmusic";
import { searchResult } from "@/api/search";
import { useSearchChannelFilter } from "@/composables/useSearchChannelFilter";
import { formatSongsList } from "@/utils/format";
import { formatQQSearchSongs } from "@/utils/qq";

const props = defineProps<{
  keyword: string;
}>();

/** 单页数量 */
const NETEASE_PAGE_SIZE = 50;
const TENCENT_PAGE_SIZE = 30;

const filterState = useSearchChannelFilter();

const neteaseSongs = ref<SongType[]>([]);
const tencentSongs = ref<SongType[]>([]);
const neteaseState = reactive({ offset: 0, hasMore: true });
const tencentState = reactive({ page: 1, hasMore: true });
const loading = ref(true);
const loaded = ref(false);

const hasMore = computed(() => neteaseState.hasMore || tencentState.hasMore);

// 按渠道筛选后的播放列表
const filteredSongs = computed(() => {
  const channel = filterState?.selected ?? "all";
  if (channel === "netease") return neteaseSongs.value;
  if (channel === "tencent") return tencentSongs.value;
  return [...neteaseSongs.value, ...tencentSongs.value];
});

// 只把真正有结果的渠道交给搜索页展示
const publishChannels = () => {
  if (!filterState) return;
  const channels: SearchChannelOption[] = [];
  if (neteaseSongs.value.length > 0) channels.push({ value: "netease", label: "网易云音乐" });
  if (tencentSongs.value.length > 0) channels.push({ value: "tencent", label: "QQ 音乐" });
  filterState.channels = channels;
  if (filterState.selected !== "all" && !channels.some((c) => c.value === filterState.selected)) {
    filterState.selected = "all";
  }
};

// 同一渠道内按 ID 去重
const appendSongs = (list: SongType[], songs: SongType[]): SongType[] => {
  const ids = new Set(list.map((song) => song.id));
  return [...list, ...songs.filter((song) => !ids.has(song.id))];
};

// 网易云单曲搜索
const loadNetease = async () => {
  const result = await searchResult(props.keyword, NETEASE_PAGE_SIZE, neteaseState.offset, 1);
  const songs = formatSongsList(result.result?.songs);
  const total = Number(result.result?.songCount) || 0;
  neteaseSongs.value = appendSongs(neteaseSongs.value, songs);
  neteaseState.offset += NETEASE_PAGE_SIZE;
  neteaseState.hasMore =
    Boolean(result.result?.hasMore) ||
    (total > neteaseState.offset && songs.length === NETEASE_PAGE_SIZE);
};

// QQ 音乐单曲搜索
const loadTencent = async () => {
  const result = await qqMusicSearch(props.keyword, tencentState.page, TENCENT_PAGE_SIZE);
  const data = result as { code?: number; songs?: unknown; total?: number };
  if (data?.code && data.code !== 200) {
    tencentState.hasMore = false;
    return;
  }
  const songs = formatQQSearchSongs(data?.songs);
  const total = Number(data?.total) || 0;
  tencentSongs.value = appendSongs(tencentSongs.value, songs);
  tencentState.page += 1;
  tencentState.hasMore =
    songs.length === TENCENT_PAGE_SIZE && (total === 0 || tencentSongs.value.length < total);
};

// 首次加载：同时请求两个渠道，任一失败不影响另一个
const getSearchResult = async () => {
  loading.value = true;
  await Promise.allSettled([loadNetease(), loadTencent()]);
  loaded.value = true;
  loading.value = false;
  publishChannels();
};

// 列表触底：继续加载还有数据的渠道
const reachBottom = async () => {
  if (loading.value || !hasMore.value) return;
  loading.value = true;
  const tasks: Promise<void>[] = [];
  if (neteaseState.hasMore) tasks.push(loadNetease());
  if (tencentState.hasMore) tasks.push(loadTencent());
  await Promise.allSettled(tasks);
  loading.value = false;
  publishChannels();
};

onMounted(() => {
  if (filterState) filterState.selected = "all";
  getSearchResult();
});

onActivated(() => {
  publishChannels();
});
</script>
