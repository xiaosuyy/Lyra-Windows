import type { SongType } from "@/types/main";
import { userLike, userPlaylist } from "@/api/user";
import { songDetail, likeSong } from "@/api/song";
import { playlistTracks } from "@/api/playlist";
import { qqMusicAddLiked, qqMusicLiked } from "@/api/qqmusic";
import { formatSongsList } from "@/utils/format";
import { formatQQSongs } from "@/utils/qq";
import { dedupeSongsByIdentity, getSongIdentityKey } from "@/utils/song";
import { isLogin } from "@/utils/auth";
import { useAccountStore, useDataStore, useLibraryStore } from "@/stores";

/** 收藏导入 / 同步支持的平台 */
export type FavoritesChannel = "netease" | "tencent";
export type FavoritesActionMode = "import" | "sync";

export interface FavoritesChannelAccount {
  channelId: FavoritesChannel;
  displayName: string;
  avatarUrl?: string;
}

export interface FavoritesActionResult {
  channelId: FavoritesChannel;
  added: number;
  skippedExisting: number;
  skippedUnsupported: number;
  failed: number;
  error?: string;
}

/** 与手机端一致：单次导入上限 */
const MAX_FAVORITES = 5000;
/** 网易云歌曲详情批量大小 */
const NETEASE_DETAIL_BATCH = 200;
/** 网易云歌单批量写入大小 */
const NETEASE_WRITE_BATCH = 300;
/** QQ 音乐批量收藏大小 */
const TENCENT_WRITE_BATCH = 50;

export const favoritesChannelLabel = (channelId: FavoritesChannel): string =>
  channelId === "netease" ? "网易云音乐" : "QQ 音乐";

/**
 * 已登录且可参与导入 / 同步的账号（与手机端一致，仅正常登录态）
 */
export const getFavoritesChannelAccounts = (): FavoritesChannelAccount[] => {
  const dataStore = useDataStore();
  const accountStore = useAccountStore();
  const accounts: FavoritesChannelAccount[] = [];
  if (isLogin() === 1) {
    accounts.push({
      channelId: "netease",
      displayName: dataStore.userData.name || favoritesChannelLabel("netease"),
      avatarUrl: dataStore.userData.avatarUrl,
    });
  }
  if (accountStore.qqLoggedIn) {
    accounts.push({
      channelId: "tencent",
      displayName: accountStore.qqDisplayName || favoritesChannelLabel("tencent"),
      avatarUrl: accountStore.qqAvatar,
    });
  }
  return accounts;
};

/**
 * 将导入歌曲按跨渠道标识合并进本地收藏，重复歌曲跳过
 */
const mergeImportedSongs = async (
  songs: SongType[],
): Promise<{ added: number; skippedExisting: number }> => {
  const dataStore = useDataStore();
  const existed = dataStore.likeSongsList.data || [];
  const existedKeys = new Set(existed.map((song) => getSongIdentityKey(song)).filter(Boolean));
  const fresh: SongType[] = [];
  for (const song of songs) {
    const key = getSongIdentityKey(song);
    if (!key || existedKeys.has(key)) continue;
    existedKeys.add(key);
    fresh.push(song);
  }
  if (fresh.length > 0) {
    const merged = dedupeSongsByIdentity([...fresh, ...existed]);
    await dataStore.setLikeSongsList(dataStore.likeSongsList.detail, merged);
    const ids = new Set<number>((dataStore.userLikeData.songs || []).map(Number));
    merged.forEach((song) => {
      const id = Number(song.id);
      if (id) ids.add(id);
    });
    await dataStore.setUserLikeData("songs", [...ids].filter(Boolean));
    useLibraryStore().scheduleSync();
  }
  return { added: fresh.length, skippedExisting: songs.length - fresh.length };
};

/**
 * 补全本地收藏歌曲快照
 * 「我喜欢的音乐」页面未打开时缓存可能为空，按收藏 ID 拉取歌曲详情
 */
export const ensureFavoriteSnapshots = async (): Promise<SongType[]> => {
  const dataStore = useDataStore();
  const cached = dataStore.likeSongsList.data || [];
  const ids = Array.from(
    new Set<number>((dataStore.userLikeData.songs || []).map(Number).filter((id) => id > 0)),
  ).slice(0, MAX_FAVORITES);
  const cachedIds = new Set(cached.map((song) => Number(song.id)));
  const missing = ids.filter((id) => !cachedIds.has(id));
  if (missing.length === 0) return cached;
  const fetched: SongType[] = [];
  for (let index = 0; index < missing.length; index += NETEASE_DETAIL_BATCH) {
    try {
      const detail = await songDetail(missing.slice(index, index + NETEASE_DETAIL_BATCH));
      fetched.push(...formatSongsList(detail?.songs || []));
    } catch (error) {
      console.warn("补全我喜欢的音乐失败", error);
    }
  }
  if (fetched.length === 0) return cached;
  const merged = dedupeSongsByIdentity([...cached, ...fetched]);
  await dataStore.setLikeSongsList(dataStore.likeSongsList.detail, merged);
  return merged;
};

/** 读取网易云「我喜欢的音乐」完整歌曲快照 */
const fetchNeteaseLikedSongs = async (): Promise<SongType[]> => {
  const dataStore = useDataStore();
  const userId = Number(dataStore.userData.userId);
  if (!userId) throw new Error("无法读取网易云账号信息");
  const result = await userLike(userId);
  if (!result) throw new Error("无法读取网易云「我喜欢的音乐」");
  const ids = Array.from(
    new Set<number>((result.ids || []).map(Number).filter((id: number) => id > 0)),
  ).slice(0, MAX_FAVORITES);
  const songs: SongType[] = [];
  for (let index = 0; index < ids.length; index += NETEASE_DETAIL_BATCH) {
    const detail = await songDetail(ids.slice(index, index + NETEASE_DETAIL_BATCH));
    songs.push(...formatSongsList(detail?.songs || []));
  }
  return songs;
};

/** 分页读取 QQ 音乐「我喜欢」歌曲（与手机端口径一致） */
const fetchTencentLikedSongs = async (): Promise<SongType[]> => {
  const songs: SongType[] = [];
  let begin = 0;
  let total = Number.MAX_SAFE_INTEGER;
  while (begin < total && songs.length < MAX_FAVORITES) {
    const response = await qqMusicLiked(begin, 200);
    const raw = Array.isArray(response?.data?.songs) ? response.data.songs : [];
    if (raw.length === 0) break;
    songs.push(...formatQQSongs(raw));
    begin += raw.length;
    const reported = Number(response?.data?.total);
    total = reported > 0 ? reported : Number.MAX_SAFE_INTEGER;
  }
  return songs.slice(0, MAX_FAVORITES);
};

const importNeteaseFavorites = async (): Promise<FavoritesActionResult> => {
  if (isLogin() !== 1) throw new Error("请先登录网易云音乐");
  const songs = await fetchNeteaseLikedSongs();
  const { added, skippedExisting } = await mergeImportedSongs(songs);
  return { channelId: "netease", added, skippedExisting, skippedUnsupported: 0, failed: 0 };
};

const importTencentFavorites = async (): Promise<FavoritesActionResult> => {
  const accountStore = useAccountStore();
  if (!accountStore.qqLoggedIn) throw new Error("请先登录 QQ 音乐");
  const songs = await fetchTencentLikedSongs();
  const { added, skippedExisting } = await mergeImportedSongs(songs);
  return { channelId: "tencent", added, skippedExisting, skippedUnsupported: 0, failed: 0 };
};

/** 网易云收藏歌单 ID（用于批量写入） */
const resolveNeteaseLikedPlaylistId = async (userId: number): Promise<number> => {
  try {
    const result = await userPlaylist(50, 0, userId);
    const list = Array.isArray(result?.playlist) ? result.playlist : [];
    const liked =
      list.find((item: { specialType?: number }) => Number(item?.specialType) === 5) ||
      list.find((item: { name?: string }) => String(item?.name || "").includes("我喜欢的音乐"));
    return Number(liked?.id) || 0;
  } catch {
    return 0;
  }
};

const pushNeteaseFavorites = async (songs: SongType[]): Promise<FavoritesActionResult> => {
  const dataStore = useDataStore();
  if (isLogin() !== 1) throw new Error("请先登录网易云音乐");
  // QQ / 本地文件 / 电台 / 流媒体歌曲没有可用的网易云歌曲 ID
  const supported = songs.filter(
    (song) =>
      song.origin !== "tencent" &&
      !song.qqMid &&
      !song.path &&
      song.type === "song" &&
      Number(song.id) > 0,
  );
  const skippedUnsupported = songs.length - supported.length;
  if (supported.length === 0) {
    return { channelId: "netease", added: 0, skippedExisting: 0, skippedUnsupported, failed: 0 };
  }
  let existingIds = new Set<number>();
  try {
    const result = await userLike(dataStore.userData.userId);
    existingIds = new Set((result?.ids || []).map(Number));
  } catch (error) {
    console.warn("读取网易云收藏失败，将继续尝试同步", error);
  }
  const pending: number[] = [];
  const seen = new Set<number>();
  let skippedExisting = 0;
  for (const song of supported) {
    const id = Number(song.id);
    if (existingIds.has(id) || seen.has(id)) {
      skippedExisting += 1;
      continue;
    }
    seen.add(id);
    pending.push(id);
  }
  if (pending.length === 0) {
    return { channelId: "netease", added: 0, skippedExisting, skippedUnsupported, failed: 0 };
  }
  const likedPlaylistId = await resolveNeteaseLikedPlaylistId(Number(dataStore.userData.userId));
  let added = 0;
  let failed = 0;
  for (let index = 0; index < pending.length; index += NETEASE_WRITE_BATCH) {
    const chunk = pending.slice(index, index + NETEASE_WRITE_BATCH);
    try {
      if (likedPlaylistId > 0) {
        const result = await playlistTracks(likedPlaylistId, chunk, "add");
        const code = Number(result?.body?.code ?? result?.code ?? 0);
        if (code === 200) added += chunk.length;
        else failed += chunk.length;
      } else {
        for (const id of chunk) {
          try {
            const result = await likeSong(id, true);
            if (Number(result?.code ?? 200) === 200) added += 1;
            else failed += 1;
          } catch {
            failed += 1;
          }
        }
      }
    } catch (error) {
      console.warn("同步收藏到网易云失败", error);
      failed += chunk.length;
    }
  }
  return { channelId: "netease", added, skippedExisting, skippedUnsupported, failed };
};

/** 读取 QQ 音乐已收藏歌曲的 mid 集合 */
const fetchTencentLikedMids = async (): Promise<Set<string>> => {
  const mids = new Set<string>();
  let begin = 0;
  let total = Number.MAX_SAFE_INTEGER;
  while (begin < total && mids.size < MAX_FAVORITES) {
    const response = await qqMusicLiked(begin, 200);
    const raw = Array.isArray(response?.data?.songs) ? response.data.songs : [];
    if (raw.length === 0) break;
    raw.forEach((item: { mid?: string }) => {
      if (item?.mid) mids.add(item.mid);
    });
    begin += raw.length;
    const reported = Number(response?.data?.total);
    total = reported > 0 ? reported : Number.MAX_SAFE_INTEGER;
  }
  return mids;
};

const pushTencentFavorites = async (songs: SongType[]): Promise<FavoritesActionResult> => {
  const accountStore = useAccountStore();
  if (!accountStore.qqLoggedIn) throw new Error("请先登录 QQ 音乐");
  const supported = songs.filter((song) => Boolean(song.qqMid));
  const skippedUnsupported = songs.length - supported.length;
  if (supported.length === 0) {
    return { channelId: "tencent", added: 0, skippedExisting: 0, skippedUnsupported, failed: 0 };
  }
  const existingMids = await fetchTencentLikedMids().catch(() => null);
  const pending: string[] = [];
  const seen = new Set<string>();
  let skippedExisting = 0;
  for (const song of supported) {
    const mid = String(song.qqMid);
    if ((existingMids && existingMids.has(mid)) || seen.has(mid)) {
      skippedExisting += 1;
      continue;
    }
    seen.add(mid);
    pending.push(mid);
  }
  let added = 0;
  let failed = 0;
  for (let index = 0; index < pending.length; index += TENCENT_WRITE_BATCH) {
    const chunk = pending.slice(index, index + TENCENT_WRITE_BATCH);
    try {
      const response = await qqMusicAddLiked(chunk);
      added += Number(response?.data?.added) || 0;
      failed += Number(response?.data?.failed) || 0;
    } catch (error) {
      console.warn("同步收藏到 QQ 音乐失败", error);
      failed += chunk.length;
    }
  }
  return { channelId: "tencent", added, skippedExisting, skippedUnsupported, failed };
};

/**
 * 执行导入 / 同步，逐个平台返回结果（单个平台失败不影响其他平台）
 */
export const runFavoritesAction = async (
  mode: FavoritesActionMode,
  channels: FavoritesChannel[],
): Promise<FavoritesActionResult[]> => {
  const songs = mode === "sync" ? await ensureFavoriteSnapshots() : [];
  const results: FavoritesActionResult[] = [];
  for (const channelId of channels) {
    try {
      results.push(
        mode === "import"
          ? channelId === "netease"
            ? await importNeteaseFavorites()
            : await importTencentFavorites()
          : channelId === "netease"
            ? await pushNeteaseFavorites(songs)
            : await pushTencentFavorites(songs),
      );
    } catch (error) {
      results.push({
        channelId,
        added: 0,
        skippedExisting: 0,
        skippedUnsupported: 0,
        failed: 0,
        error: (error as Error).message || "操作失败",
      });
    }
  }
  return results;
};

/** 汇总结果文案（与手机端提示口径一致） */
export const summarizeFavoritesResults = (
  results: FavoritesActionResult[],
  mode: FavoritesActionMode,
): string =>
  results
    .map((result) => {
      const label = favoritesChannelLabel(result.channelId);
      if (result.error) return `${label} 操作失败：${result.error}`;
      if (mode === "import") {
        if (result.added === 0 && result.skippedExisting === 0) {
          return `${label} 对方收藏为空，没有可导入的歌曲`;
        }
        return `${label} 导入完成：新增 ${result.added} 首，已存在 ${result.skippedExisting} 首`;
      }
      return `${label} 同步完成：新增 ${result.added}，已存在/跳过 ${
        result.skippedExisting + result.skippedUnsupported
      }，失败 ${result.failed}`;
    })
    .join("；");

/** 是否存在失败项 */
export const hasFavoritesError = (results: FavoritesActionResult[]): boolean =>
  results.some((result) => Boolean(result.error) || result.failed > 0);
