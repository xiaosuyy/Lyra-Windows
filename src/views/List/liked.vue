<!-- 我喜欢的音乐 -->
<template>
  <div class="liked-list">
    <ListDetail
      :detail-data="detailData"
      :list-data="listData"
      :loading="showLoading"
      :list-scrolling="listScrolling"
      :search-value="searchValue"
      :config="listConfig"
      :play-button-text="playButtonText"
      :more-options="moreOptions"
      title-text="我喜欢的音乐"
      hide-comment-tab
      @update:search-value="handleSearchUpdate"
      @play-all="playAllSongs"
    />
    <Transition name="fade" mode="out-in">
      <SongList
        v-if="!searchValue || searchData?.length"
        :data="displayData"
        :loading="loading"
        :height="songListHeight"
        :playListId="playlistId"
        :draggable="canDragSort"
        :doubleClickAction="searchData?.length ? 'add' : 'all'"
        @scroll="handleListScroll"
        @removeSong="removeSong"
        @reorder="handleReorder"
      />
      <n-empty
        v-else
        :description="`搜不到关于 ${searchValue} 的任何歌曲呀`"
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
import type { DropdownOption } from "naive-ui";
import { SongType } from "@/types/main";
import { songDetail } from "@/api/song";
import { playlistDetail, playlistAllSongs, songOrderUpdate } from "@/api/playlist";
import { formatCoverList, formatSongsList } from "@/utils/format";
import { renderIcon, copyData, getShareUrl } from "@/utils/helper";
import { isObject } from "lodash-es";
import { isLogin } from "@/utils/auth";
import { useDataStore, useLibraryStore, useStatusStore } from "@/stores";
import { likeSong } from "@/api/song";
import { openBatchList, openFavoritesPicker, openUpdatePlaylist } from "@/utils/modal";
import { updateUserLikePlaylist } from "@/utils/auth";
import { useListDetail } from "@/composables/List/useListDetail";
import { useListSearch } from "@/composables/List/useListSearch";
import { useListScroll } from "@/composables/List/useListScroll";
import { useListActions } from "@/composables/List/useListActions";

const dataStore = useDataStore();
const libraryStore = useLibraryStore();
const statusStore = useStatusStore();

// 是否激活
const isActivated = ref<boolean>(false);

const {
  detailData,
  listData,
  loading,
  getSongListHeight,
  setDetailData,
  setListData,
  appendListData,
  setLoading,
} = useListDetail();
const { searchValue, searchData, displayData, clearSearch, performSearch } =
  useListSearch(listData);
const { listScrolling, handleListScroll, resetScroll } = useListScroll();
const { playAllSongs: playAllSongsAction } = useListActions();

// 歌单 ID：优先按名称定位「我喜欢的音乐」，避免账号歌单顺序变化后拿错歌单
const playlistId = computed<number>(() => {
  const list = dataStore.userLikeData.playlists || [];
  const liked = list.find((item) => String(item?.name || "").includes("我喜欢的音乐"));
  return Number(liked?.id ?? list[0]?.id) || 0;
});

// 是否可拖拽排序（默认排序 + 非搜索模式）
const canDragSort = computed(() => {
  return !searchValue.value && statusStore.listSortField === "default";
});

// 请求令牌：只允许最后一次刷新写入列表和缓存
let requestToken = 0;

/**
 * 收藏合并：保持本地现有顺序，账号里新增的收藏补到最前面，绝不丢歌
 */
const mergeWithCachedFavorites = (incoming: SongType[]): SongType[] => {
  // 账号接口偶尔会重复返回同一首歌，先按 ID 去重再合并
  const incomingById = new Map(incoming.map((song) => [Number(song.id), song]));
  const uniqueIncoming = [...incomingById.values()];
  const cachedById = new Map(
    (dataStore.likeSongsList.data || []).map((song) => [Number(song.id), song]),
  );
  const cached = [...cachedById.values()];
  if (uniqueIncoming.length === 0) {
    return cached.filter((song) => !libraryStore.isFavoriteRemoved(Number(song.id)));
  }
  const cachedIds = new Set(cachedById.keys());
  const fresh = uniqueIncoming.filter((song) => !cachedIds.has(Number(song.id)));
  // 已有歌曲用最新详情覆盖，但位置不动
  const refreshed = cached.map((song) => incomingById.get(Number(song.id)) ?? song);
  // 已取消喜欢的歌曲即使账号接口还没刷新，也不要再显示
  return [...fresh, ...refreshed].filter(
    (song) => !libraryStore.isFavoriteRemoved(Number(song.id)),
  );
};

/** 收藏 ID 与列表保持并集，离线收藏也能正常显示已喜欢状态 */
const syncFavoriteIds = async (songs: SongType[]) => {
  const ids = new Set((dataStore.userLikeData.songs || []).map(Number));
  const before = ids.size;
  songs.forEach((song) => {
    const id = Number(song.id);
    if (id && !libraryStore.isFavoriteRemoved(id)) ids.add(id);
  });
  if (ids.size > before) {
    await dataStore.setUserLikeData("songs", [...ids]);
  }
};

// 列表高度
const songListHeight = computed(() => getSongListHeight(listScrolling.value));

// 列表配置
const listConfig = {
  titleType: "normal" as const,
  showCoverMask: true,
  showPlayCount: true,
  showArtist: false,
  showCreator: true,
  showCount: false,
  searchAlign: "center" as const,
};

// 是否显示加载状态
const showLoading = computed(() => listData.value.length === 0 && loading.value);

// 播放按钮文本
const playButtonText = computed(() => {
  if (showLoading.value) {
    const loaded =
      listData.value.length === (detailData.value?.count || 0) ? 0 : listData.value.length;
    return `正在更新... (${loaded}/${detailData.value?.count || 0})`;
  }
  return "播放";
});

// 更多操作
const moreOptions = computed<DropdownOption[]>(() => [
  {
    label: "刷新缓存",
    key: "refresh",
    show: isLogin() === 1 && Boolean(playlistId.value),
    props: {
      onClick: () => loadPlaylistData(playlistId.value, true),
    },
    icon: renderIcon("Refresh"),
  },
  {
    label: "编辑歌单",
    key: "edit",
    show: isLogin() === 1 && Boolean(playlistId.value),
    props: {
      onClick: () => {
        if (!detailData.value || !playlistId.value) return;
        openUpdatePlaylist(playlistId.value, detailData.value, () =>
          loadPlaylistData(playlistId.value, false),
        );
      },
    },
    icon: renderIcon("EditNote"),
  },
  {
    label: "批量操作",
    key: "batch",
    props: {
      onClick: () => openBatchList(displayData.value, false, playlistId.value),
    },
    icon: renderIcon("Batch"),
  },
  {
    label: "导入收藏",
    key: "import",
    props: {
      onClick: () => openFavoritesPicker("import"),
    },
    icon: renderIcon("Download"),
  },
  {
    label: "同步收藏",
    key: "sync",
    props: {
      onClick: () => openFavoritesPicker("sync"),
    },
    icon: renderIcon("Update"),
  },
  {
    label: "复制分享链接",
    key: "copy",
    show: Boolean(playlistId.value),
    props: {
      onClick: () => copyData(getShareUrl("playlist", playlistId.value), "已复制分享链接到剪贴板"),
    },
    icon: renderIcon("Share"),
  },
  {
    label: "打开源页面",
    key: "open",
    show: Boolean(playlistId.value),
    props: {
      onClick: () => {
        window.open(`https://music.163.com/#/playlist?id=${playlistId.value}`);
      },
    },
    icon: renderIcon("Link"),
  },
]);

/**
 * 加载歌单数据
 * @param id 歌单 ID
 * @param forceRefresh 是否强制刷新（忽略缓存）
 */
const loadPlaylistData = async (id: number, forceRefresh: boolean = false) => {
  if (!id) return;
  const token = ++requestToken;
  setLoading(true);
  clearSearch();
  if (!forceRefresh) {
    loadLikedCache();
  } else {
    setDetailData(null);
    setListData([]);
    resetScroll();
  }
  try {
    const detail = await playlistDetail(id);
    if (token !== requestToken) return;
    // 更新歌单详情
    setDetailData(formatCoverList(detail.playlist)[0]);
    // 获取全部 ID 顺序
    const serverIds: number[] = detail.privileges?.map((p: any) => p.id) || [];
    const trackCount = detail.playlist?.trackCount || 0;

    let complete = false;
    // 如果 privileges 数量少于 trackCount，说明数据不完整，需要全量获取
    if (serverIds.length < trackCount && trackCount > 0) {
      console.log(`🔄 Liked songs incomplete (${serverIds.length}/${trackCount}), fetching all...`);
      complete = await fetchAllSongs(id, trackCount, token);
    } else if (serverIds.length > 0) {
      // 同步歌曲列表
      complete = await syncSongList(serverIds, id, token);
    } else {
      // 服务器收藏为空：保留本地缓存，不覆盖
      complete = true;
    }
    if (token !== requestToken) return;

    if (complete && detailData.value) {
      const merged = mergeWithCachedFavorites(listData.value);
      setListData(merged);
      // 合并后的列表才不会丢歌，再写入缓存
      await dataStore.setLikeSongsList(detailData.value, merged);
      await syncFavoriteIds(merged);
    } else {
      // 拉取失败或不完整：回退本地缓存，避免把列表清空 / 截断后同步出去
      loadLikedCache();
    }
  } catch (error) {
    console.error("Failed to load playlist data:", error);
    if (token === requestToken) loadLikedCache();
  } finally {
    if (token === requestToken) {
      setLoading(false);
    }
  }
};

/**
 * 全量获取歌曲列表
 * 当 privileges 数据不完整时调用
 */
const fetchAllSongs = async (id: number, total: number, token: number): Promise<boolean> => {
  const limit = 500;
  let offset = 0;
  const allSongs: SongType[] = [];

  while (offset < total) {
    if (token !== requestToken) return false;
    try {
      const result = await playlistAllSongs(id, limit, offset);
      if (token !== requestToken) return false;
      const songs = formatSongsList(result.songs);
      allSongs.push(...songs);
      // 实时更新列表展示
      if (offset === 0) {
        setListData(mergeWithCachedFavorites(allSongs));
      } else {
        appendListData(songs);
      }
      offset += limit;
    } catch (error) {
      console.error("Failed to fetch all songs:", error);
      return false;
    }
  }

  if (token !== requestToken) return false;
  if (allSongs.length === 0) return false;
  setListData(mergeWithCachedFavorites(allSongs));
  console.log(`✅ Fetched all ${allSongs.length} liked songs`);
  return allSongs.length >= total;
};

/**
 * 加载缓存
 */
const loadLikedCache = () => {
  if (isObject(dataStore.likeSongsList.detail)) {
    setDetailData(dataStore.likeSongsList.detail);
  }
  if (dataStore.likeSongsList.data.length) {
    setListData(
      dataStore.likeSongsList.data.filter(
        (song) => !libraryStore.isFavoriteRemoved(Number(song.id)),
      ),
    );
  }
};

/**
 * 同步歌曲列表
 * 根据服务器返回的 ID 顺序，增量获取缺失的歌曲详情
 * @param serverIds 服务器返回的 ID 列表（官方顺序）
 * @param requestId 当前请求 ID
 */
const syncSongList = async (serverIds: number[], id: number, token: number): Promise<boolean> => {
  // 当前缓存的歌曲 Map
  const cachedMap = new Map(listData.value.map((s) => [s.id, s]));
  // 找出缺失的 ID
  const missingIds = serverIds.filter((id) => !cachedMap.has(id));
  // 获取缺失的歌曲详情
  let failed = false;
  if (missingIds.length > 0) {
    console.log(`🔄 Syncing liked songs: found ${missingIds.length} missing songs`);
    const limit = 500;
    let offset = 0;
    while (offset < missingIds.length) {
      if (token !== requestToken) return false;
      const chunk = missingIds.slice(offset, offset + limit);
      try {
        const result = await songDetail(chunk);
        const songs = formatSongsList(result.songs);
        songs.forEach((song) => cachedMap.set(song.id, song));
      } catch (error) {
        console.error("Failed to fetch song details:", error);
        failed = true;
      }
      offset += limit;
    }
  }
  if (token !== requestToken) return false;
  // 有歌曲详情没取到时不写入缓存，避免把服务器上已有的歌从收藏里抹掉
  if (failed) return false;
  // 重建列表
  const newList = serverIds
    .map((songId) => cachedMap.get(songId))
    .filter((s): s is SongType => !!s);
  if (newList.length === 0 && serverIds.length > 0) return false;
  setListData(mergeWithCachedFavorites(newList));
  // 更新详情（失败不影响歌曲列表）
  try {
    const detail = await playlistDetail(id);
    if (token === requestToken) {
      setDetailData(formatCoverList(detail.playlist)[0]);
    }
  } catch (error) {
    console.warn("刷新我喜欢的音乐详情失败", error);
  }
  console.log("✅ 我喜欢的音乐已同步到服务器顺序");
  return true;
};

/**
 * 检查缓存是否需要更新
 * 只有账号里出现缓存中没有的收藏时才拉取；缓存里的离线收藏不算缺失
 */
const checkNeedsUpdate = (): boolean => {
  const cachedIds = new Set(dataStore.likeSongsList.data.map((song) => Number(song.id)));
  const missing = (dataStore.userLikeData.songs || []).filter((id) => !cachedIds.has(Number(id)));
  if (missing.length > 0) {
    console.log(`🔄 我喜欢的音乐缓存需要更新: 缺少 ${missing.length} 首`);
    return true;
  }
  console.log("✅ 我喜欢的音乐缓存已更新");
  return false;
};

// 处理搜索更新
const handleSearchUpdate = (val: string) => {
  searchValue.value = val;
  performSearch(val);
};

// 播放全部歌曲
const playAllSongs = useDebounceFn(() => {
  if (!detailData.value || !displayData.value?.length) return;
  playAllSongsAction(displayData.value, playlistId.value);
}, 300);

// 删除指定索引歌曲
const removeSong = async (ids: number[]) => {
  if (!listData.value) return;
  const removeIds = new Set(ids);
  setListData(listData.value.filter((song) => !removeIds.has(song.id)));
  // 同步本地收藏
  const likedIds = dataStore.userLikeData.songs.filter((id) => !removeIds.has(id));
  await dataStore.setUserLikeData("songs", likedIds);
  const snapshots = dataStore.likeSongsList.data.filter((song) => !removeIds.has(song.id));
  await dataStore.setLikeSongsList(detailData.value ?? dataStore.likeSongsList.detail, snapshots);
  // 写入删除记录，其他设备的旧列表不会把歌曲带回来
  libraryStore.markFavoritesRemoved(ids);
  libraryStore.scheduleSync();
  // 已登录时同步到网易云
  if (isLogin() === 1) {
    await Promise.allSettled(ids.map((id) => likeSong(id, false)));
  }
};

// 拖拽重排序
const handleReorder = async (fromIndex: number, toIndex: number) => {
  if (fromIndex === toIndex) return;

  // 乐观更新视图
  const newList = [...listData.value];
  const [moved] = newList.splice(fromIndex, 1);
  newList.splice(toIndex, 0, moved);
  setListData(newList);

  // 未登录或离线时仅保存本地顺序
  if (!playlistId.value || isLogin() !== 1) {
    if (detailData.value) await dataStore.setLikeSongsList(detailData.value, newList);
    libraryStore.scheduleSync();
    return;
  }

  // 持久化到服务端
  try {
    const ids = newList.map((s) => s.id);
    const result = await songOrderUpdate(playlistId.value, ids);
    if (result.code !== 200) {
      window.$message.error("保存排序失败");
      loadPlaylistData(playlistId.value, true);
    } else {
      // 更新缓存
      if (detailData.value) {
        dataStore.setLikeSongsList(detailData.value, newList);
      }
    }
  } catch (error) {
    console.error("Failed to update song order:", error);
    window.$message.error("保存排序失败，请重试");
    loadPlaylistData(playlistId.value, true);
  }
};

// 启动加载或 WebDAV 同步写入缓存后刷新视图
watch([() => dataStore.likeSongsList.detail, () => dataStore.likeSongsList.data], () => {
  if (loading.value) return;
  loadLikedCache();
});

onActivated(async () => {
  if (!isActivated.value) {
    isActivated.value = true;
  } else {
    // 登录状态下检查是否需要更新缓存
    if (isLogin() === 1 && playlistId.value && checkNeedsUpdate()) {
      await loadPlaylistData(playlistId.value, false);
    }
  }
});

onMounted(async () => {
  // 优先生成本地缓存视图，未登录 / 离线也可使用
  loadLikedCache();
  if (isLogin() !== 1) {
    setLoading(false);
    return;
  }
  // 确保用户歌单数据已加载
  if (!dataStore.userLikeData.playlists?.length) {
    try {
      await updateUserLikePlaylist();
    } catch (error) {
      console.error("Failed to update user playlist data:", error);
      setLoading(false);
      return;
    }
  }

  // 获取我喜欢的音乐歌单 ID
  if (playlistId.value) {
    loadPlaylistData(playlistId.value);
  } else {
    // 如果没有找到我喜欢的音乐歌单，尝试从缓存获取
    const data: any = await dataStore.getUserLikePlaylist();
    const id = data?.detail?.id;
    if (id) {
      loadPlaylistData(id);
    } else {
      setLoading(false);
      if (dataStore.likeSongsList.data.length === 0) {
        window.$message.error("无法获取我喜欢的音乐歌单");
      }
    }
  }
});
</script>
