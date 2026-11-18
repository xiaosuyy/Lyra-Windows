import type { CoverType, MetaData, SongType } from "@/types/main";
import { hashStringToId } from "@/utils/song";

/** QQ 音乐接口返回的歌曲结构 */
export interface QQSongPayload {
  mid: string;
  songId: string;
  name: string;
  artist: string;
  album: string;
  albumMid: string;
  durationMs: number;
  cover: string;
  mediaMid: string;
}

/** QQ 音乐歌单 / 排行榜结构 */
export interface QQPlaylistPayload {
  id: number;
  name: string;
  cover: string;
  trackCount?: number;
  playCount?: number;
}

/** 将字符串稳定映射为数字 ID（QQ 歌曲没有可用的数字 ID 时使用） */
const hashId = hashStringToId;

const splitArtists = (value: string): MetaData[] =>
  value
    .split(/\s*[/、&,，]\s*/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ id: hashId(name), name }));

/**
 * QQ 歌曲转换为应用歌曲结构
 */
export const formatQQSong = (song: QQSongPayload): SongType => {
  const numericId = Number(song.songId);
  return {
    id: Number.isFinite(numericId) && numericId > 0 ? numericId : hashId(song.mid),
    name: song.name,
    artists: splitArtists(song.artist),
    album: {
      id: 0,
      name: song.album,
      cover: song.cover,
    },
    cover: song.cover,
    duration: Math.max(0, song.durationMs || 0),
    free: 0,
    mv: null,
    type: "song",
    origin: "tencent",
    qqMid: song.mid,
    qqMediaMid: song.mediaMid || song.albumMid || "",
  };
};

/**
 * 批量转换 QQ 歌曲
 */
export const formatQQSongs = (data: unknown): SongType[] => {
  if (!Array.isArray(data)) return [];
  return data
    .filter((item): item is QQSongPayload => Boolean(item?.mid && item?.name))
    .map((item) => formatQQSong(item));
};

/** QQ 音乐搜索结果结构 */
export interface QQSearchSongPayload {
  id: string;
  mid: string;
  name: string;
  artist: string;
  album: string;
  albumMid?: string;
  mediaMid?: string;
  cover?: string;
  duration?: number;
}

/**
 * QQ 搜索结果转换为应用歌曲结构（duration 为毫秒）
 */
export const formatQQSearchSongs = (data: unknown): SongType[] => {
  if (!Array.isArray(data)) return [];
  return data
    .filter((item): item is QQSearchSongPayload => Boolean(item?.mid && item?.name))
    .map((item) => {
      const albumMid = item.albumMid || "";
      return formatQQSong({
        mid: item.mid,
        songId: item.id,
        name: item.name,
        artist: item.artist,
        album: item.album,
        albumMid,
        durationMs: Number(item.duration) || 0,
        cover:
          item.cover ||
          (albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : ""),
        mediaMid: item.mediaMid || albumMid,
      });
    });
};

/**
 * QQ 歌单转换为封面列表结构
 */
export const formatQQPlaylists = (data: unknown): CoverType[] => {
  if (!Array.isArray(data)) return [];
  return data
    .filter((item): item is QQPlaylistPayload => Boolean(item?.id && item?.name))
    .map((item) => ({
      id: item.id,
      name: item.name,
      cover: item.cover || "/images/album.jpg?asset",
      artists: "",
      creator: { id: 0, name: "", avatarUrl: "" },
      count: item.trackCount || 0,
      playCount: item.playCount || 0,
    }));
};
