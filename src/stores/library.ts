import { defineStore } from "pinia";
import localforage from "localforage";
import { cloneDeep, debounce } from "lodash-es";
import type { ArtistType, CoverType, MetaData, SongType, UserLikeDataType } from "@/types/main";
import { isElectron } from "@/utils/env";
import { dedupeSongsByIdentity, toNumericSongId } from "@/utils/song";
import { useAccountStore, type SyncedProfile } from "./account";
import { useDataStore } from "./data";
import { useSettingStore } from "./setting";

/**
 * 可离线使用的歌单
 * songs 保存完整歌曲快照，断网时依然可以浏览和播放本地缓存
 */
export interface LibraryPlaylist {
  /** 本地歌单 ID（16 位数字） */
  id: number;
  name: string;
  description?: string;
  cover: string;
  songs: SongType[];
  /** 我创建 / 我收藏 */
  kind: "created" | "liked";
  /** 云端歌单 ID（网易云） */
  remoteId?: number;
  /** 云端来源 */
  remoteSource?: "netease" | "tencent";
  createTime: number;
  updateTime: number;
}

/**
 * WebDAV 同步内容：与 Lyra 手机端 SyncData（version "2.0"）兼容。
 * 手机端默认省流写入 GZIP(ProtoBuf)，主进程已解码为等价的 JSON 结构。
 */
interface MobileSyncSong {
  id: number;
  name: string;
  artist: string;
  album: string;
  albumId?: number;
  durationMs?: number;
  coverUrl?: string | null;
  mediaUri?: string | null;
  addedAt?: number;
  channelId?: string | null;
  audioId?: string | null;
  matchedSongId?: string | null;
}

interface MobileSyncPlaylist {
  id: number;
  name: string;
  songs?: MobileSyncSong[];
  createdAt?: number;
  modifiedAt?: number;
  isDeleted?: boolean;
  songOrderVersion?: number;
}

interface MobileSyncFavoritePlaylist {
  id: number;
  name: string;
  coverUrl?: string | null;
  trackCount?: number;
  source?: string;
  songs?: MobileSyncSong[];
  addedTime?: number;
  modifiedAt?: number;
  isDeleted?: boolean;
  sortOrder?: number;
  playlistId?: string | null;
  browseId?: string | null;
  subtitle?: string | null;
}

interface MobileSyncRecentPlay {
  songId?: number;
  song?: MobileSyncSong;
  playedAt?: number;
  deviceId?: string;
}

interface MobileSyncData {
  version?: string;
  deviceId?: string;
  deviceName?: string;
  lastModified?: number;
  playlists?: MobileSyncPlaylist[];
  favoritePlaylists?: MobileSyncFavoritePlaylist[];
  recentPlays?: MobileSyncRecentPlay[];
  recentPlayDeletions?: { songId?: number }[];
  playlistSongDeletions?: { playlistId?: number; songId?: number }[];
  profileDisplayName?: string;
  profileAvatarBase64?: string;
  profileUpdatedAt?: number;
  [key: string]: unknown;
}

/** 桌面端旧版同步结构，仅用于读取迁移 */
interface LegacySyncPayload {
  version?: number;
  updatedAt?: number;
  likedSongs?: SongType[];
  likedIds?: number[];
  likedDetail?: CoverType;
  history?: SongType[];
  playlists?: LibraryPlaylist[];
  favorites?: UserLikeDataType;
}

interface FavoriteTombstone {
  id: number;
  source: string;
  playlistId: string | null;
}

/** 在线歌单身份，用于阻止账号歌单列表刷新后重新导入已删歌单 */
interface RemotePlaylistRef {
  source: "netease" | "tencent";
  remoteId: number;
}

/** 待同步的删除墓碑，需要长期保留，否则旧快照会把已删歌单带回来 */
interface PendingDelete {
  id: number;
  at: number;
  favorite?: FavoriteTombstone;
  remote?: RemotePlaylistRef;
}

/** 归一化后的同步内容 */
interface NormalizedSync {
  likedSongs: SongType[];
  likedIds: number[];
  history: SongType[];
  created: LibraryPlaylist[];
  favorites: LibraryPlaylist[];
  favoriteMeta: {
    albums: CoverType[];
    artists: ArtistType[];
    mvs: CoverType[];
    djs: CoverType[];
  };
  deletedPlaylistIds: number[];
  deletedFavorites: FavoriteTombstone[];
  removedFromPlaylist: { playlistId: number; songIds: number[] }[];
  deletedHistoryIds: number[];
  profile: SyncedProfile;
  extras: Record<string, unknown>;
}

/** 我喜欢的音乐在手机端的系统歌单 ID */
const FAVORITES_PLAYLIST_ID = -1001;
/** 手机端系统歌单（我喜欢的音乐 / 本地文件），不进入桌面歌单列表 */
const SYSTEM_PLAYLIST_IDS = new Set([-1001, -1002]);

const libraryDB = localforage.createInstance({
  name: "lyra-library",
  description: "Offline library of Lyra",
  storeName: "library",
});

/** 生成 16 位数字歌单 ID */
const generatePlaylistId = (): number => {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return Number(timestamp + random);
};

const uniqueById = <T extends { id?: number | string }>(local: T[], remote: T[]): T[] => {
  const map = new Map<number | string, T>();
  remote.forEach((item) => {
    if (item?.id !== undefined) map.set(item.id, item);
  });
  // 本地数据优先
  local.forEach((item) => {
    if (item?.id !== undefined) map.set(item.id, item);
  });
  return Array.from(map.values());
};

const uniqueSongs = (list: SongType[]): SongType[] => {
  const map = new Map<number, SongType>();
  list.forEach((song) => {
    if (song?.id && !map.has(song.id)) map.set(song.id, song);
  });
  return Array.from(map.values());
};

const splitArtists = (value: string): MetaData[] =>
  value
    .split(/\s*[/、,;&]\s*/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ id: 0, name }));

const artistsToText = (artists: MetaData[] | string): string => {
  if (typeof artists === "string") return artists;
  return (artists || [])
    .map((item) => item?.name)
    .filter(Boolean)
    .join("/");
};

/** 超过 12 小时视为旧版同步把毫秒当成秒二次放大 */
const normalizeSyncDuration = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 12 * 60 * 60 * 1000 ? Math.round(value / 1000) : Math.round(value);
};

const mobileSongToSong = (song?: MobileSyncSong | null): SongType | null => {
  const id = Number(song?.id);
  if (!Number.isFinite(id) || id === 0) return null;
  const channel = String(song?.channelId ?? "").toLowerCase();
  const origin = channel === "tencent" || channel === "qq" ? "tencent" : "netease";
  const audioId = song?.audioId?.trim() || undefined;
  return {
    id,
    name: song?.name || "未知歌曲",
    artists: splitArtists(song?.artist || ""),
    album: { id: Number(song?.albumId) || 0, name: song?.album || "" },
    cover: song?.coverUrl || "",
    duration: normalizeSyncDuration(Number(song?.durationMs) || 0),
    free: 0,
    mv: null,
    type: "song",
    origin,
    qqMid: origin === "tencent" && audioId && !/^\d+$/.test(audioId) ? audioId : undefined,
  };
};

const songToMobile = (song: SongType): MobileSyncSong => ({
  id: toNumericSongId(song),
  name: song.name ?? "",
  artist: artistsToText(song.artists),
  album: typeof song.album === "string" ? song.album : (song.album?.name ?? ""),
  albumId: typeof song.album === "object" ? Number(song.album?.id) || 0 : 0,
  durationMs: normalizeSyncDuration(Number(song.duration) || 0),
  coverUrl: song.cover || null,
  mediaUri: null,
  addedAt: 0,
  channelId: song.origin === "tencent" ? "tencent" : "netease",
  audioId: song.qqMid || song.qqMediaMid || null,
});

const mapSongs = (songs?: MobileSyncSong[]): SongType[] =>
  (songs || [])
    .map((song) => mobileSongToSong(song))
    .filter((song): song is SongType => Boolean(song));

/**
 * 手机端 SyncData -> 桌面归一化数据
 */
const parseMobileSync = (data: MobileSyncData): NormalizedSync => {
  const likedSongs: SongType[] = [];
  const created: LibraryPlaylist[] = [];
  const favorites: LibraryPlaylist[] = [];
  const deletedPlaylistIds: number[] = [];
  const deletedFavorites: FavoriteTombstone[] = [];
  const favoriteMeta: NormalizedSync["favoriteMeta"] = {
    albums: [],
    artists: [],
    mvs: [],
    djs: [],
  };

  for (const item of data.playlists || []) {
    const id = Number(item?.id) || 0;
    if (!id) continue;
    if (item.isDeleted) {
      deletedPlaylistIds.push(id);
      continue;
    }
    const songs = mapSongs(item.songs);
    if (id === FAVORITES_PLAYLIST_ID) {
      likedSongs.push(...songs);
      continue;
    }
    if (SYSTEM_PLAYLIST_IDS.has(id)) continue;
    const updatedAt = Number(item.modifiedAt) || Number(item.createdAt) || Date.now();
    created.push({
      id,
      name: item.name || "未命名歌单",
      cover: songs[0]?.cover ?? "",
      songs,
      kind: "created",
      createTime: Number(item.createdAt) || updatedAt,
      updateTime: updatedAt,
    });
  }

  for (const item of data.favoritePlaylists || []) {
    if (item?.isDeleted) {
      const id = Number(item?.playlistId ?? item?.id) || Number(item?.id) || 0;
      if (id) {
        deletedFavorites.push({
          id,
          source: String(item.source ?? "netease"),
          playlistId: item.playlistId ?? null,
        });
      }
      continue;
    }
    const source = String(item?.source ?? "");
    const remoteId = Number(item?.playlistId ?? item?.id) || Number(item?.id) || 0;
    if (!remoteId) continue;
    const songs = mapSongs(item.songs);
    const cover = item.coverUrl || songs[0]?.cover || "";
    if (source === "neteaseArtist") {
      favoriteMeta.artists.push({ id: remoteId, name: item.name || "", cover });
      continue;
    }
    if (source === "neteaseAlbum") {
      favoriteMeta.albums.push({ id: remoteId, name: item.name || "", cover });
      continue;
    }
    if (source !== "netease" && source !== "tencent") continue;
    const updatedAt = Number(item.modifiedAt) || Number(item.addedTime) || Date.now();
    favorites.push({
      id: remoteId,
      name: item.name || "收藏的歌单",
      cover,
      songs,
      kind: "liked",
      remoteId,
      remoteSource: source,
      createTime: Number(item.addedTime) || updatedAt,
      updateTime: updatedAt,
    });
  }

  const history = (data.recentPlays || [])
    .slice()
    .sort((a, b) => (Number(b.playedAt) || 0) - (Number(a.playedAt) || 0))
    .map((item) => mobileSongToSong(item.song))
    .filter((song): song is SongType => Boolean(song));
  const deletedHistoryIds = (data.recentPlayDeletions || [])
    .map((item) => Number(item.songId) || 0)
    .filter(Boolean);

  const removedFromPlaylist = new Map<number, Set<number>>();
  for (const item of data.playlistSongDeletions || []) {
    const playlistId = Number(item.playlistId) || 0;
    const songId = Number(item.songId) || 0;
    if (!playlistId || !songId) continue;
    if (!removedFromPlaylist.has(playlistId)) removedFromPlaylist.set(playlistId, new Set());
    removedFromPlaylist.get(playlistId)?.add(songId);
  }

  const extras: Record<string, unknown> = {};
  const owned = [
    "version",
    "deviceId",
    "deviceName",
    "lastModified",
    "playlists",
    "favoritePlaylists",
    "recentPlays",
  ];
  Object.keys(data).forEach((key) => {
    if (!owned.includes(key)) extras[key] = data[key];
  });

  return {
    likedSongs: uniqueSongs(likedSongs),
    likedIds: uniqueSongs(likedSongs).map((song) => song.id),
    history: uniqueSongs(history),
    created,
    favorites,
    favoriteMeta,
    deletedPlaylistIds,
    deletedFavorites,
    removedFromPlaylist: Array.from(removedFromPlaylist, ([playlistId, ids]) => ({
      playlistId,
      songIds: [...ids],
    })),
    deletedHistoryIds,
    profile: {
      displayName: String(data.profileDisplayName || "").trim(),
      avatarBase64: String(data.profileAvatarBase64 || "").trim(),
      updatedAt: Number(data.profileUpdatedAt) || 0,
    },
    extras,
  };
};

/**
 * 桌面端旧版同步结构 -> 归一化数据（升级迁移）
 */
const parseLegacySync = (data: LegacySyncPayload): NormalizedSync => {
  const created: LibraryPlaylist[] = [];
  const favorites: LibraryPlaylist[] = [];
  for (const item of data.playlists || []) {
    if (!item?.id) continue;
    if (item.kind === "liked") favorites.push(item);
    else created.push(item);
  }
  for (const item of data.favorites?.playlists || []) {
    const remoteId = Number(item?.id) || 0;
    if (!remoteId || favorites.some((p) => p.remoteId === remoteId)) continue;
    favorites.push({
      id: remoteId,
      name: item.name || "收藏的歌单",
      cover: item.cover || "",
      songs: [],
      kind: "liked",
      remoteId,
      remoteSource: "netease",
      createTime: Number(item.createTime) || 0,
      updateTime: Number(item.updateTime) || 0,
    });
  }
  return {
    likedSongs: data.likedSongs || [],
    likedIds: data.likedIds || [],
    history: data.history || [],
    created,
    favorites,
    favoriteMeta: {
      albums: data.favorites?.albums || [],
      artists: data.favorites?.artists || [],
      mvs: data.favorites?.mvs || [],
      djs: data.favorites?.djs || [],
    },
    deletedPlaylistIds: [],
    deletedFavorites: [],
    removedFromPlaylist: [],
    deletedHistoryIds: [],
    profile: {},
    extras: {},
  };
};

const parseSyncContent = (raw: string): NormalizedSync | null => {
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const isMobile =
      typeof data.version === "string" ||
      Array.isArray(data.favoritePlaylists) ||
      Array.isArray(data.recentPlays);
    return isMobile ? parseMobileSync(data as MobileSyncData) : parseLegacySync(data);
  } catch {
    return null;
  }
};

/**
 * 本地音乐库：收藏 / 歌单 / 最近播放离线可用，并通过 WebDAV 同步
 */
export const useLibraryStore = defineStore("library", () => {
  const playlists = ref<LibraryPlaylist[]>([]);
  /** 已删除歌单的墓碑，长期保留：手机端同样持久化删除记录 */
  const pendingDeletes = ref<PendingDelete[]>([]);
  const initialized = ref(false);
  const syncing = ref(false);
  const lastSyncAt = ref(0);
  const syncError = ref("");

  const normalizeSource = (source?: string): "netease" | "tencent" =>
    source === "tencent" ? "tencent" : "netease";

  /** 远端歌单是否已被本地删除（按来源 + 远端 ID 判断，防止重新导入/合并复活） */
  const isRemotePlaylistDeleted = (source: string, remoteId: number): boolean => {
    const target = normalizeSource(source);
    return pendingDeletes.value.some(
      (item) =>
        (item.remote?.remoteId === remoteId && item.remote.source === target) ||
        (item.favorite?.id === remoteId && item.favorite.source === target),
    );
  };

  /** 用户主动重新收藏时撤销删除墓碑 */
  const clearRemoteTombstone = (source: string, remoteId: number) => {
    const target = normalizeSource(source);
    pendingDeletes.value = pendingDeletes.value.filter(
      (item) =>
        !(item.remote?.remoteId === remoteId && item.remote.source === target) &&
        !(item.favorite?.id === remoteId && item.favorite.source === target),
    );
  };

  const createdPlaylists = computed(() => playlists.value.filter((p) => p.kind === "created"));
  const likedPlaylists = computed(() => playlists.value.filter((p) => p.kind === "liked"));

  const save = async () => {
    await libraryDB.setItem("playlists", cloneDeep(toRaw(playlists.value)));
    await libraryDB.setItem("pending-deletes", cloneDeep(toRaw(pendingDeletes.value)));
  };

  const findPlaylist = (id: number | string | undefined | null) => {
    if (!id) return undefined;
    return playlists.value.find((p) => p.id.toString() === id.toString());
  };

  const isLibraryPlaylist = (id: number | string | undefined | null): boolean =>
    Boolean(findPlaylist(id));

  const touch = (playlist: LibraryPlaylist) => {
    playlist.updateTime = Date.now();
    scheduleSync();
  };

  const createPlaylist = async (name: string, description?: string): Promise<LibraryPlaylist> => {
    const now = Date.now();
    const playlist: LibraryPlaylist = {
      id: generatePlaylistId(),
      name: name.trim(),
      description: description?.trim() || undefined,
      cover: "",
      songs: [],
      kind: "created",
      createTime: now,
      updateTime: now,
    };
    playlists.value.unshift(playlist);
    await save();
    scheduleSync();
    return playlist;
  };

  const updatePlaylist = async (
    id: number,
    patch: Partial<Pick<LibraryPlaylist, "name" | "description" | "cover">>,
  ): Promise<boolean> => {
    const playlist = findPlaylist(id);
    if (!playlist) return false;
    if (patch.name !== undefined) playlist.name = patch.name;
    if (patch.description !== undefined) playlist.description = patch.description;
    if (patch.cover !== undefined) playlist.cover = patch.cover;
    touch(playlist);
    await save();
    return true;
  };

  const deletePlaylist = async (id: number): Promise<boolean> => {
    const index = playlists.value.findIndex((p) => p.id === id);
    if (index === -1) return false;
    const target = playlists.value[index];
    playlists.value.splice(index, 1);
    if (!pendingDeletes.value.some((item) => item.id === id)) {
      const source = normalizeSource(target.remoteSource);
      pendingDeletes.value.push({
        id,
        at: Date.now(),
        favorite:
          target.kind === "liked" && target.remoteId
            ? {
                id: target.remoteId,
                source,
                playlistId: String(target.remoteId),
              }
            : undefined,
        // 在线歌单删除后仍留在账号列表里，记录身份避免下次刷新再导入
        remote: target.remoteId ? { source, remoteId: target.remoteId } : undefined,
      });
    }
    await save();
    scheduleSync();
    return true;
  };

  const addSongs = async (id: number, songs: SongType[]): Promise<number> => {
    const playlist = findPlaylist(id);
    if (!playlist || songs.length === 0) return 0;
    const existing = new Set(playlist.songs.map((song) => song.id));
    const fresh = songs.filter((song) => song.id && !existing.has(song.id));
    if (fresh.length === 0) return 0;
    playlist.songs.unshift(...cloneDeep(fresh));
    if (!playlist.cover && playlist.songs[0]?.cover) playlist.cover = playlist.songs[0].cover;
    touch(playlist);
    await save();
    return fresh.length;
  };

  const removeSongs = async (id: number, songIds: number[]): Promise<boolean> => {
    const playlist = findPlaylist(id);
    if (!playlist) return false;
    const ids = new Set(songIds);
    playlist.songs = playlist.songs.filter((song) => !ids.has(song.id));
    touch(playlist);
    await save();
    return true;
  };

  const reorderSongs = async (id: number, from: number, to: number): Promise<boolean> => {
    const playlist = findPlaylist(id);
    if (!playlist) return false;
    if (from < 0 || from >= playlist.songs.length || to < 0 || to >= playlist.songs.length) {
      return false;
    }
    if (from === to) return true;
    const [moved] = playlist.songs.splice(from, 1);
    playlist.songs.splice(to, 0, moved);
    touch(playlist);
    await save();
    return true;
  };

  /**
   * 将网易云歌单元数据导入本地库
   */
  const importRemotePlaylists = async (list: CoverType[], userId: number) => {
    if (!Array.isArray(list) || list.length === 0) return;
    let changed = false;
    for (const item of list) {
      const remoteId = Number(item.id);
      if (!remoteId) continue;
      if (String(item.name).includes("我喜欢的音乐")) continue;
      // 本地已删除的歌单不再从账号列表重新导入
      if (isRemotePlaylistDeleted("netease", remoteId)) continue;
      const kind = item.userId === userId ? "created" : "liked";
      const existing = playlists.value.find(
        (p) => p.remoteSource === "netease" && p.remoteId === remoteId,
      );
      if (existing) {
        if (existing.name !== item.name) {
          existing.name = item.name;
          changed = true;
        }
        if (item.cover && existing.cover !== item.cover && existing.songs.length === 0) {
          existing.cover = item.cover;
          changed = true;
        }
        if (existing.kind !== kind) {
          existing.kind = kind;
          changed = true;
        }
      } else {
        const now = Date.now();
        playlists.value.push({
          id: generatePlaylistId(),
          name: item.name,
          cover: item.cover || "",
          songs: [],
          kind,
          remoteId,
          remoteSource: "netease",
          createTime: now,
          updateTime: now,
        });
        changed = true;
      }
    }
    if (changed) {
      await save();
      scheduleSync();
    }
  };

  /**
   * 首次打开收藏歌单时缓存完整歌曲列表
   */
  const hydrateRemotePlaylist = async (id: number): Promise<LibraryPlaylist | undefined> => {
    const playlist = findPlaylist(id);
    if (!playlist) return undefined;
    if (!playlist.remoteId || playlist.songs.length > 0) return playlist;
    try {
      if (playlist.remoteSource === "tencent") {
        const [{ qqMusicPlaylist }, { formatQQSongs }] = await Promise.all([
          import("@/api/qqmusic"),
          import("@/utils/qq"),
        ]);
        const result = await qqMusicPlaylist(playlist.remoteId, 200);
        const songs = formatQQSongs(result?.data?.songs);
        if (songs.length > 0) {
          playlist.songs = songs;
          if (!playlist.cover && songs[0]?.cover) playlist.cover = songs[0].cover;
          touch(playlist);
          await save();
        }
        return playlist;
      }
      if (playlist.remoteSource !== "netease") return playlist;
      const [{ playlistDetail, playlistAllSongs }, { formatCoverList, formatSongsList }] =
        await Promise.all([import("@/api/playlist"), import("@/utils/format")]);
      const detail = await playlistDetail(playlist.remoteId);
      const formatted = formatCoverList(detail.playlist)[0];
      const count = Number(detail.playlist?.trackCount) || 0;
      const songs: SongType[] = [];
      const limit = 500;
      let offset = 0;
      do {
        const result = await playlistAllSongs(playlist.remoteId, limit, offset);
        songs.push(...formatSongsList(result.songs));
        offset += limit;
      } while (offset < count && offset < 5000);
      if (playlist.remoteId === detail.playlist?.id) {
        if (formatted?.name) playlist.name = formatted.name;
        if (formatted?.cover) playlist.cover = formatted.cover;
      }
      if (songs.length > 0) {
        playlist.songs = songs;
        touch(playlist);
        await save();
      }
    } catch (error) {
      console.warn("缓存收藏歌单失败，将使用本地数据", error);
    }
    return playlist;
  };

  /** 按来源与云端 ID 查找收藏歌单 */
  const findFavoritePlaylist = (
    remoteId: number,
    source: "netease" | "tencent",
  ): LibraryPlaylist | undefined =>
    playlists.value.find(
      (item) =>
        item.kind === "liked" &&
        item.remoteId === remoteId &&
        (item.remoteSource ?? "netease") === source,
    );

  const isFavoritePlaylist = (remoteId: number, source: "netease" | "tencent"): boolean =>
    Boolean(remoteId) && Boolean(findFavoritePlaylist(remoteId, source));

  /** 收藏远端歌单：写入本地音乐库并随 WebDAV 同步 */
  const addFavoritePlaylist = async (payload: {
    remoteId: number;
    source: "netease" | "tencent";
    name: string;
    cover?: string;
    description?: string;
    songs?: SongType[];
  }): Promise<LibraryPlaylist | undefined> => {
    const remoteId = Number(payload.remoteId);
    if (!remoteId) return undefined;
    // 用户主动重新收藏，撤销之前的删除墓碑
    clearRemoteTombstone(payload.source, remoteId);
    const songs = cloneDeep(payload.songs || []);
    const cover = payload.cover || songs[0]?.cover || "";
    const now = Date.now();
    const existing = findFavoritePlaylist(remoteId, payload.source);
    if (existing) {
      existing.name = payload.name || existing.name;
      if (cover) existing.cover = cover;
      if (payload.description !== undefined) existing.description = payload.description;
      if (songs.length > 0) existing.songs = songs;
      touch(existing);
      await save();
      return existing;
    }
    const playlist: LibraryPlaylist = {
      id: generatePlaylistId(),
      name: payload.name || "收藏的歌单",
      description: payload.description,
      cover,
      songs,
      kind: "liked",
      remoteId,
      remoteSource: payload.source,
      createTime: now,
      updateTime: now,
    };
    playlists.value.unshift(playlist);
    await save();
    scheduleSync();
    return playlist;
  };

  /** 取消收藏远端歌单 */
  const removeFavoritePlaylist = async (
    remoteId: number,
    source: "netease" | "tencent",
  ): Promise<boolean> => {
    const target = findFavoritePlaylist(Number(remoteId), source);
    if (!target) return false;
    return deletePlaylist(target.id);
  };

  const getDeviceId = async (): Promise<string> => {
    let deviceId = await libraryDB.getItem<string>("sync-device-id");
    if (!deviceId) {
      deviceId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `desktop-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await libraryDB.setItem("sync-device-id", deviceId);
    }
    return deviceId;
  };

  /**
   * 构建同步内容（Lyra 手机端 SyncData v2）
   */
  const buildSyncData = async (extras: Record<string, unknown>): Promise<MobileSyncData> => {
    const dataStore = useDataStore();
    const now = Date.now();
    const deviceId = await getDeviceId();
    const mobilePlaylists: MobileSyncPlaylist[] = [];
    const mobileFavorites: MobileSyncFavoritePlaylist[] = [];
    const favoriteKeys = new Set<string>();

    // 我喜欢的音乐 -> 手机端系统歌单 -1001
    // 本地 / 流媒体歌曲仅当前设备可见，不同步为在线喜欢列表
    const likedSongs = uniqueSongs(cloneDeep(toRaw(dataStore.likeSongsList.data || []))).filter(
      (song) => !song.path && song.type !== "streaming",
    );
    if (likedSongs.length > 0) {
      mobilePlaylists.push({
        id: FAVORITES_PLAYLIST_ID,
        name: "我喜欢的音乐",
        songs: likedSongs.map(songToMobile),
        createdAt: now,
        modifiedAt: now,
        isDeleted: false,
        songOrderVersion: 1,
      });
    }

    for (const item of playlists.value) {
      if (pendingDeletes.value.some((entry) => entry.id === item.id)) continue;
      if (item.kind === "created") {
        mobilePlaylists.push({
          id: item.id,
          name: item.name,
          songs: item.songs.map(songToMobile),
          createdAt: item.createTime || now,
          modifiedAt: item.updateTime || now,
          isDeleted: false,
          songOrderVersion: 1,
        });
        continue;
      }
      const source = item.remoteSource === "tencent" ? "tencent" : "netease";
      const id = item.remoteId ?? item.id;
      favoriteKeys.add(`${source}:${id}`);
      mobileFavorites.push({
        id,
        name: item.name,
        coverUrl: item.cover || null,
        trackCount: item.songs.length,
        source,
        songs: item.songs.map(songToMobile),
        addedTime: item.createTime || now,
        modifiedAt: item.updateTime || now,
        isDeleted: false,
        sortOrder: item.createTime || now,
        playlistId: item.remoteId ? String(item.remoteId) : null,
        browseId: null,
        subtitle: null,
      });
    }

    // 收藏元数据（专辑 / 歌手）以手机端收藏歌单条目形式同步
    const metaSources = [
      ["albums", "neteaseAlbum"],
      ["artists", "neteaseArtist"],
    ] as const;
    for (const [key, source] of metaSources) {
      for (const item of dataStore.userLikeData[key] || []) {
        const id = Number(item?.id) || 0;
        if (!id || favoriteKeys.has(`${source}:${id}`)) continue;
        favoriteKeys.add(`${source}:${id}`);
        mobileFavorites.push({
          id,
          name: item.name || "",
          coverUrl: item.cover || null,
          trackCount: 0,
          source,
          songs: [],
          addedTime: now,
          modifiedAt: now,
          isDeleted: false,
          sortOrder: now,
          playlistId: null,
          browseId: null,
          subtitle: null,
        });
      }
    }

    // 删除墓碑：让手机端同步删除
    for (const item of pendingDeletes.value) {
      if (item.favorite) {
        mobileFavorites.push({
          id: item.favorite.id,
          name: "",
          coverUrl: null,
          trackCount: 0,
          source: item.favorite.source,
          songs: [],
          addedTime: item.at,
          modifiedAt: item.at,
          isDeleted: true,
          sortOrder: item.at,
          playlistId: item.favorite.playlistId,
          browseId: null,
          subtitle: null,
        });
        continue;
      }
      mobilePlaylists.push({
        id: item.id,
        name: "",
        songs: [],
        createdAt: item.at,
        modifiedAt: item.at,
        isDeleted: true,
        songOrderVersion: 1,
      });
    }

    // 最近播放 -> recentPlays
    const deletedHistoryIds = new Set(
      ((extras.recentPlayDeletions as { songId?: number }[] | undefined) || [])
        .map((item) => Number(item.songId) || 0)
        .filter(Boolean),
    );
    const recentPlays: MobileSyncRecentPlay[] = dedupeSongsByIdentity(
      cloneDeep(toRaw(dataStore.historyList || [])),
    )
      .filter((song) => !deletedHistoryIds.has(toNumericSongId(song)))
      .slice(0, 500)
      .map((song, index) => {
        // 手机端 songId 为 Long，必须与内嵌歌曲使用同一个数字 ID
        const mobileSong = songToMobile(song);
        return {
          songId: mobileSong.id,
          song: mobileSong,
          playedAt: now - index * 1000,
          deviceId,
        };
      });

    // 本机修改过的个人资料覆盖远端旧值
    const accountStore = useAccountStore();
    const profile: Partial<MobileSyncData> = {};
    if (accountStore.profileUpdatedAt > 0) {
      profile.profileDisplayName = accountStore.profileName;
      profile.profileAvatarBase64 = accountStore.profileAvatar;
      profile.profileUpdatedAt = accountStore.profileUpdatedAt;
    }

    return {
      ...extras,
      ...profile,
      version: "2.0",
      deviceId,
      deviceName: "Lyra Desktop",
      lastModified: now,
      playlists: mobilePlaylists,
      favoritePlaylists: mobileFavorites,
      recentPlays,
    };
  };

  /**
   * 合并远端数据到本地
   */
  const applySync = async (sync: NormalizedSync) => {
    const dataStore = useDataStore();

    // 我喜欢的音乐
    const localSongs = dataStore.likeSongsList.data || [];
    const mergedSongs = uniqueSongs([...localSongs, ...sync.likedSongs]);
    const mergedIds = Array.from(
      new Set([
        ...(dataStore.userLikeData.songs || []),
        ...sync.likedIds,
        ...mergedSongs.map((song) => song.id),
      ]),
    );
    if (mergedIds.length > 0) {
      await dataStore.setUserLikeData("songs", mergedIds);
    }
    if (mergedSongs.length > 0) {
      await dataStore.setLikeSongsList(dataStore.likeSongsList.detail, mergedSongs);
    }

    // 最近播放
    const deletedHistoryIds = new Set(sync.deletedHistoryIds);
    const mergedHistory = dedupeSongsByIdentity([...(dataStore.historyList || []), ...sync.history])
      .filter((song) => !deletedHistoryIds.has(song.id))
      .slice(0, 500);
    if (mergedHistory.length > 0) await dataStore.setHistoryList(mergedHistory);

    // 远端删除的歌单 / 歌单内删除的歌曲
    const pendingIds = new Set(pendingDeletes.value.map((item) => item.id));
    if (sync.deletedPlaylistIds.length > 0) {
      const ids = new Set(sync.deletedPlaylistIds);
      playlists.value = playlists.value.filter((item) => !ids.has(item.id));
      // 保留删除墓碑，让下次上传仍然携带
      for (const id of ids) {
        if (!pendingIds.has(id)) {
          pendingIds.add(id);
          pendingDeletes.value.push({ id, at: Date.now() });
        }
      }
    }
    for (const { playlistId, songIds } of sync.removedFromPlaylist) {
      const target = playlists.value.find((entry) => entry.id === playlistId);
      if (!target) continue;
      const ids = new Set(songIds);
      target.songs = target.songs.filter((song) => !ids.has(song.id));
    }
    if (sync.deletedFavorites.length > 0) {
      for (const item of sync.deletedFavorites) {
        const source = item.source;
        playlists.value = playlists.value.filter(
          (entry) =>
            !(
              entry.kind === "liked" &&
              entry.remoteId === item.id &&
              (entry.remoteSource ?? "netease") === source
            ),
        );
        if (
          !pendingDeletes.value.some(
            (entry) => entry.favorite?.id === item.id && entry.favorite?.source === item.source,
          )
        ) {
          pendingDeletes.value.push({
            id: item.id,
            at: Date.now(),
            favorite: item,
            // 专辑 / 歌手收藏与歌单 ID 不在同一命名空间，只记录歌单来源
            remote:
              source === "netease" || source === "tencent"
                ? { source, remoteId: item.id }
                : undefined,
          });
        }
      }
    }

    // 歌单合并
    for (const remote of [...sync.created, ...sync.favorites]) {
      if (pendingIds.has(remote.id)) continue;
      // 收藏歌单的远端 ID 与本地 ID 可能不同，需按来源 + 远端 ID 再判断一次
      if (
        remote.kind === "liked" &&
        remote.remoteId &&
        isRemotePlaylistDeleted(remote.remoteSource ?? "netease", remote.remoteId)
      ) {
        continue;
      }
      let local = playlists.value.find((item) => item.id === remote.id);
      if (!local && remote.kind === "liked" && remote.remoteId) {
        local = playlists.value.find(
          (item) => item.remoteSource === remote.remoteSource && item.remoteId === remote.remoteId,
        );
      }
      if (!local) {
        playlists.value.push(remote);
        continue;
      }
      if ((remote.updateTime || 0) > (local.updateTime || 0)) {
        const id = local.id;
        // 远端快照可能没有歌曲（如从未缓存的在线歌单），不要因此清空本地内容
        const songs = remote.songs.length > 0 ? remote.songs : local.songs;
        const cover = remote.cover || local.cover;
        Object.assign(local, remote, { id, songs, cover });
      } else {
        local.songs = uniqueSongs([...local.songs, ...remote.songs]);
        if (!local.cover && remote.cover) local.cover = remote.cover;
      }
    }
    await save();

    // 收藏元数据
    if (sync.favoriteMeta.albums.length > 0) {
      await dataStore.setUserLikeData(
        "albums",
        uniqueById(dataStore.userLikeData.albums, sync.favoriteMeta.albums),
      );
    }
    if (sync.favoriteMeta.artists.length > 0) {
      await dataStore.setUserLikeData(
        "artists",
        uniqueById(dataStore.userLikeData.artists, sync.favoriteMeta.artists),
      );
    }
    if (sync.favoriteMeta.mvs.length > 0) {
      await dataStore.setUserLikeData(
        "mvs",
        uniqueById(dataStore.userLikeData.mvs, sync.favoriteMeta.mvs),
      );
    }
    if (sync.favoriteMeta.djs.length > 0) {
      await dataStore.setUserLikeData(
        "djs",
        uniqueById(dataStore.userLikeData.djs, sync.favoriteMeta.djs),
      );
    }

    // 手机端个人资料（名称 / 头像）
    if (Number(sync.profile.updatedAt) > 0) {
      useAccountStore().applySyncedProfile(sync.profile);
    }
  };

  /**
   * 立即同步：先拉取合并，再上传合并结果
   */
  const syncNow = async (silent = false): Promise<{ success: boolean; error?: string }> => {
    if (!isElectron) return { success: false, error: "仅桌面端支持同步" };
    const accountStore = useAccountStore();
    if (!accountStore.configured) {
      const error = "请先登录 WebDAV";
      if (!silent) window.$message.warning(error);
      return { success: false, error };
    }
    if (syncing.value) return { success: false, error: "正在同步中" };
    syncing.value = true;
    syncError.value = "";
    try {
      const downloaded = await window.api.webdav.syncDownload();
      let extras: Record<string, unknown> = {};
      if (downloaded.success && downloaded.data) {
        const sync = parseSyncContent(downloaded.data);
        if (!sync) throw new Error("同步文件格式无法识别");
        await applySync(sync);
        extras = sync.extras;
      } else if (!downloaded.success) {
        throw new Error(downloaded.error || "拉取同步数据失败");
      }
      const uploaded = await window.api.webdav.syncUpload(
        JSON.stringify(await buildSyncData(extras)),
      );
      if (!uploaded.success) throw new Error(uploaded.error || "上传同步数据失败");
      // 删除墓碑不清空：其他设备可能还保留旧快照，墓碑需要持续下发直到它们完成合并
      await save();
      lastSyncAt.value = Date.now();
      await libraryDB.setItem("last-sync-at", lastSyncAt.value);
      if (!silent) window.$message.success("已同步到 WebDAV");
      return { success: true };
    } catch (error) {
      const message = (error as Error).message;
      syncError.value = message;
      if (!silent) window.$message.error(`同步失败：${message}`);
      return { success: false, error: message };
    } finally {
      syncing.value = false;
    }
  };

  const scheduleSync = debounce(() => {
    const settingStore = useSettingStore();
    const accountStore = useAccountStore();
    if (!isElectron || !settingStore.webdavAutoSync || !accountStore.configured) return;
    syncNow(true).catch(() => undefined);
  }, 2500);

  /** 定时自动同步间隔：5 分钟 */
  const AUTO_SYNC_INTERVAL = 5 * 60 * 1000;
  let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

  // 启动每 5 分钟一次的自动同步
  const startAutoSync = () => {
    if (autoSyncTimer) clearInterval(autoSyncTimer);
    autoSyncTimer = setInterval(() => {
      const settingStore = useSettingStore();
      const accountStore = useAccountStore();
      if (!settingStore.webdavAutoSync || !accountStore.configured) return;
      if (syncing.value) return;
      syncNow(true).catch(() => undefined);
    }, AUTO_SYNC_INTERVAL);
  };

  // 首次登录 WebDAV 后立即同步一次
  watch(
    () => useAccountStore().configured,
    (value, old) => {
      if (value && !old) syncNow(true).catch(() => undefined);
    },
  );

  // 重新打开自动同步时立即同步一次
  watch(
    () => useSettingStore().webdavAutoSync,
    (value) => {
      if (value) syncNow(true).catch(() => undefined);
    },
  );

  /**
   * 初始化本地库
   */
  const init = async () => {
    if (initialized.value) return;
    try {
      const stored = await libraryDB.getItem<LibraryPlaylist[]>("playlists");
      if (Array.isArray(stored)) playlists.value = stored;
      const pending = await libraryDB.getItem<PendingDelete[]>("pending-deletes");
      if (Array.isArray(pending)) pendingDeletes.value = pending;
      lastSyncAt.value = Number(await libraryDB.getItem("last-sync-at")) || 0;
    } catch (error) {
      console.error("读取本地音乐库失败", error);
    }
    initialized.value = true;
    const accountStore = useAccountStore();
    const settingStore = useSettingStore();
    if (!isElectron) return;
    if (!accountStore.configured) {
      await accountStore.load();
    }
    startAutoSync();
    if (accountStore.configured && settingStore.webdavAutoSync) {
      syncNow(true).catch(() => undefined);
    }
  };

  return {
    playlists,
    createdPlaylists,
    likedPlaylists,
    initialized,
    syncing,
    lastSyncAt,
    syncError,
    init,
    save,
    findPlaylist,
    isLibraryPlaylist,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    addSongs,
    removeSongs,
    reorderSongs,
    importRemotePlaylists,
    hydrateRemotePlaylist,
    findFavoritePlaylist,
    isFavoritePlaylist,
    addFavoritePlaylist,
    removeFavoritePlaylist,
    syncNow,
    scheduleSync,
  };
});
