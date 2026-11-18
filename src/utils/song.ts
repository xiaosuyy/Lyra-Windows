import type { SongType } from "@/types/main";

/** 归一化歌手列表：统一分隔符，忽略大小写与空白 */
const normalizeArtists = (artists: SongType["artists"]): string => {
  const names =
    typeof artists === "string"
      ? artists.split(/\s*[/、,，&;；]\s*/)
      : (artists || []).map((item) => item?.name || "");
  return names
    .map((name) =>
      name
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s\u3000]+/g, ""),
    )
    .filter(Boolean)
    .join("/");
};

/** 归一化歌曲名：忽略大小写与空白 */
const normalizeSongName = (name?: string): string =>
  (name || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "");

/**
 * 跨渠道歌曲标识
 * 同名同歌手视为同一首歌，避免网易云 / QQ / 本地来源重复记录
 */
export const getSongIdentityKey = (song?: SongType | null): string => {
  if (!song) return "";
  const name = normalizeSongName(song.name);
  const artists = normalizeArtists(song.artists);
  if (name || artists) return `${name}|${artists}`;
  return song.path ? `path:${song.path}` : `id:${song.id}`;
};

/** 将字符串稳定映射为 32 位正整数（FNV-1a） */
export const hashStringToId = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/** 将歌曲 ID 转为同步协议要求的数字 ID（手机端为 Long） */
export const toNumericSongId = (song: SongType): number => {
  const id = Number(song.id);
  if (Number.isFinite(id) && id > 0) return Math.trunc(id);
  return hashStringToId(getSongIdentityKey(song) || String(song.id ?? ""));
};

/** 按跨渠道标识去重，保持原顺序并只保留靠前的一条 */
export const dedupeSongsByIdentity = (songs: SongType[], limit = 500): SongType[] => {
  const seen = new Set<string>();
  const result: SongType[] = [];
  for (const song of songs) {
    const key = getSongIdentityKey(song);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(song);
    if (result.length >= limit) break;
  }
  return result;
};
