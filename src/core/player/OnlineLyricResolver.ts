import { qqMusicLyric, qqMusicSearch } from "@/api/qqmusic";
import { searchResult } from "@/api/search";
import { songLyric } from "@/api/song";
import { useCacheManager } from "@/core/resource/CacheManager";
import { useSettingStore } from "@/stores";
import type { SongLyric } from "@/types/lyric";
import type { SongType } from "@/types/main";
import { isElectron } from "@/utils/env";
import {
  isExternalLyricDurationCompatible,
  isPlaceholderArtist,
  rankOnlineLyricCandidates,
  scoreLyricArtist,
  scoreLyricDuration,
  scoreLyricTitle,
  type OnlineLyricCandidate,
  type OnlineLyricMatchRequest,
  type OnlineLyricSource,
} from "@/utils/lyric/lyricMatch";
import { alignLyricLines, alignLyrics, parseQRCLyric } from "@/utils/lyric/lyricParser";
import { parseLrc } from "@/utils/lyric/parseLrc";
import { cleanTTMLTranslations } from "@/utils/lyric/parseTTML";
import { type LyricLine, parseTTML, parseYrc } from "@applemusic-like-lyrics/lyric";

/** 在线歌词来源顺序，与手机端一致：LRCLIB → 酷狗 → 网易云 → QQ 音乐 */
const ONLINE_SOURCE_ORDER: OnlineLyricSource[] = ["lrclib", "kugou", "netease", "qq"];

const MAX_DETAIL_LOOKUPS = 4;
const ONLINE_CACHE_VERSION = 1;
const ONLINE_MISS_RETRY_MS = 10 * 60 * 1000;
const AMLL_MIN_QUERY_SCORE = 70;
const AMLL_MIN_ARTIST_SCORE = 30;
const AMLL_MAX_CANDIDATES = 5;

const onlineMissAt = new Map<string, number>();

export interface ResolvedOnlineLyric {
  data: SongLyric;
  meta: { usingTTMLLyric: boolean; usingQRCLyric: boolean };
  source: OnlineLyricSource;
}

export interface ResolvedAmllLyric {
  lines: LyricLine[];
  rawTtml: string;
}

interface CachedOnlineLyric {
  version: number;
  source: OnlineLyricSource;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  lrc?: string;
  yrc?: string;
  qrc?: string;
  trans?: string;
  roma?: string;
  plain?: string;
}

interface KugouSongResult {
  id: string;
  hash: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
}

interface SearchMetadata {
  id: number;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
}

interface LrcLibResult {
  source: "lrclib";
  title: string;
  artist: string;
  durationMs: number;
  lrc?: string;
  plain?: string;
}

interface AmllSearchItem {
  file: string;
  title: string;
  titles: string[];
  artist: string;
  artists: string[];
  albums: string[];
  score: number;
}

/** 歌曲歌手文本 */
export const getSongArtistText = (song: SongType): string => {
  if (Array.isArray(song.artists)) {
    return song.artists
      .map((artist) => artist?.name)
      .filter(Boolean)
      .join("/");
  }
  return String(song.artists ?? "").trim();
};

/** 歌曲专辑文本 */
const getSongAlbumText = (song: SongType): string => {
  if (typeof song.album === "string") return song.album.trim();
  return String(song.album?.name ?? "").trim();
};

/** 本地 / QQ / 网易云 歌曲的歌词缓存键 */
const lyricCacheKey = (song: SongType): string => {
  if (song.path) return `local_${song.id}`;
  if (song.origin === "tencent") return `qq_${song.id}`;
  return String(song.id);
};

const readCacheText = async (key: string): Promise<string | null> => {
  if (!isElectron) return null;
  try {
    const result = await useCacheManager().get("lyrics", key);
    if (!result.success || !result.data) return null;
    return new TextDecoder().decode(result.data);
  } catch {
    return null;
  }
};

const writeCacheText = async (key: string, value: string): Promise<void> => {
  if (!isElectron || !useSettingStore().cacheEnabled) return;
  try {
    await useCacheManager().set("lyrics", key, value);
  } catch {
    // 缓存失败不影响歌词展示
  }
};

/** 去掉标题里的常见装饰，提高歌词库命中率 */
const buildSearchTitle = (value: string): string => {
  const cleaned = value
    .replace(/[([【（][^)\]】）]*[)\]】）]/g, " ")
    .replace(
      /(?:\s+|^)(?:official|audio|video|lyrics?|visualizer|hd|hq|4k|mv|官方|官方版|官方视频|音频|歌词|歌词版|高清|完整版)(?:\s+|$)/gi,
      " ",
    )
    .replace(/[《》<>「」『』“”"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-_|/·•~]+|[-_|/·•~]+$/g, "")
    .trim();
  return cleaned.length >= 2 ? cleaned : value.trim();
};

const buildSearchQueries = (trackName: string, artistName: string): string[] => {
  const cleaned = buildSearchTitle(trackName);
  const queries = [artistName ? `${cleaned} ${artistName}` : "", cleaned, trackName.trim()];
  return [...new Set(queries.filter(Boolean))].slice(0, 2);
};

/** 元数据候选排序：时长吻合优先，其次歌名与歌手 */
const rankMetadata = <T extends { title: string; artist: string; durationMs: number }>(
  items: T[],
  request: OnlineLyricMatchRequest,
): T[] => {
  return items
    .filter(
      (item) =>
        request.durationMs <= 0 ||
        item.durationMs <= 0 ||
        isExternalLyricDurationCompatible(request.durationMs, item.durationMs),
    )
    .sort((left, right) => {
      const leftCompatible =
        request.durationMs > 0 &&
        left.durationMs > 0 &&
        isExternalLyricDurationCompatible(request.durationMs, left.durationMs);
      const rightCompatible =
        request.durationMs > 0 &&
        right.durationMs > 0 &&
        isExternalLyricDurationCompatible(request.durationMs, right.durationMs);
      return (
        Number(rightCompatible) - Number(leftCompatible) ||
        scoreLyricTitle(request.trackName, right.title) -
          scoreLyricTitle(request.trackName, left.title) ||
        scoreLyricArtist(request.artistName, right.artist) -
          scoreLyricArtist(request.artistName, left.artist) ||
        scoreLyricDuration(request.durationMs, right.durationMs) -
          scoreLyricDuration(request.durationMs, left.durationMs)
      );
    })
    .slice(0, MAX_DETAIL_LOOKUPS);
};

/** 无时间轴歌词按歌曲时长均分 */
const plainLyricsToLines = (text: string, durationMs: number): LyricLine[] => {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (!rows.length) return [];
  const totalMs = durationMs > 0 ? durationMs : rows.length * 4000;
  const step = totalMs / rows.length;
  return rows.map((row, index) => {
    const startTime = Math.round(index * step);
    const endTime = Math.round((index + 1) * step);
    return {
      words: [{ word: row, startTime, endTime }],
      startTime,
      endTime,
      translatedLyric: "",
      romanLyric: "",
      isBG: false,
      isDuet: false,
    };
  });
};

const buildCandidateLyric = (
  candidate: OnlineLyricCandidate,
  expectedDurationMs: number,
): ResolvedOnlineLyric | null => {
  const data: SongLyric = { lrcData: [], yrcData: [] };
  if (candidate.qrc) {
    const qrcLines = parseQRCLyric(candidate.qrc, candidate.trans, candidate.roma);
    if (qrcLines.length) data.yrcData = qrcLines;
  }
  if (!data.yrcData.length && candidate.yrc) {
    let yrcLines = parseYrc(candidate.yrc) ?? [];
    if (candidate.trans && yrcLines.length) {
      yrcLines = alignLyrics(yrcLines, parseLrc(candidate.trans), "translatedLyric");
    }
    if (candidate.roma && yrcLines.length) {
      yrcLines = alignLyrics(yrcLines, parseLrc(candidate.roma), "romanLyric");
    }
    if (yrcLines.length) data.yrcData = yrcLines;
  }
  if (!data.lrcData.length && candidate.lrc) {
    let lrcLines = parseLrc(candidate.lrc) ?? [];
    if (candidate.trans && lrcLines.length) {
      lrcLines = alignLyrics(lrcLines, parseLrc(candidate.trans), "translatedLyric");
    }
    if (candidate.roma && lrcLines.length) {
      lrcLines = alignLyrics(lrcLines, parseLrc(candidate.roma), "romanLyric");
    }
    if (lrcLines.length) data.lrcData = alignLyricLines(lrcLines);
  }
  if (!data.lrcData.length && !data.yrcData.length && candidate.plain) {
    data.lrcData = plainLyricsToLines(candidate.plain, expectedDurationMs);
  }
  if (!data.lrcData.length && !data.yrcData.length) return null;
  return {
    data,
    meta: { usingTTMLLyric: false, usingQRCLyric: Boolean(data.yrcData.length) },
    source: candidate.source,
  };
};

/* -------------------------------------------------------------------------- */
/*                                各来源候选获取                               */
/* -------------------------------------------------------------------------- */

const fetchLrcLibCandidates = async (
  trackName: string,
  artistName: string,
): Promise<OnlineLyricCandidate[]> => {
  const results = (await window.electron.ipcRenderer.invoke(
    "external-lyric:lrclib-search",
    trackName,
    artistName,
  )) as LrcLibResult[];
  return (results ?? []).map((item) => ({
    source: "lrclib",
    title: item.title,
    artist: item.artist,
    durationMs: item.durationMs,
    lrc: item.lrc,
    plain: item.plain,
  }));
};

const fetchKugouCandidates = async (
  request: OnlineLyricMatchRequest,
): Promise<OnlineLyricCandidate[]> => {
  const songs = (await window.electron.ipcRenderer.invoke(
    "external-lyric:kugou-search",
    request.trackName,
    request.artistName,
  )) as KugouSongResult[];
  const candidates: OnlineLyricCandidate[] = [];
  for (const song of rankMetadata(songs ?? [], request)) {
    const payload = (await window.electron.ipcRenderer.invoke(
      "external-lyric:kugou-fetch",
      song,
    )) as Pick<OnlineLyricCandidate, "yrc" | "lrc" | "trans">;
    if (!payload?.yrc && !payload?.lrc) continue;
    candidates.push({
      source: "kugou",
      title: song.title,
      artist: song.artist,
      album: song.album,
      durationMs: song.durationMs,
      yrc: payload.yrc,
      lrc: payload.lrc,
      trans: payload.trans,
    });
  }
  return candidates;
};

const fetchNeteaseCandidates = async (
  request: OnlineLyricMatchRequest,
  queries: string[],
): Promise<OnlineLyricCandidate[]> => {
  const candidates: OnlineLyricCandidate[] = [];
  const seen = new Set<number>();
  for (const query of queries) {
    const response = await searchResult(query, 20, 0, 1);
    const songs = (response as any)?.result?.songs ?? [];
    const metadata: SearchMetadata[] = songs
      .map((item: any) => ({
        id: Number(item.id),
        title: String(item.name ?? ""),
        artist: (item.ar ?? [])
          .map((artist: any) => artist?.name)
          .filter(Boolean)
          .join("/"),
        album: String(item.al?.name ?? ""),
        durationMs: Number(item.dt) || 0,
      }))
      .filter((item: SearchMetadata) => Boolean(item.id && item.title));
    for (const item of rankMetadata(metadata, request)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      let data: any = null;
      try {
        data = await songLyric(item.id);
      } catch {
        continue;
      }
      if (!data || data.code !== 200) continue;
      candidates.push({
        source: "netease",
        title: item.title,
        artist: item.artist,
        album: item.album,
        durationMs: item.durationMs,
        yrc: data.yrc?.lyric || undefined,
        lrc: data.lrc?.lyric || undefined,
        trans: data.ytlrc?.lyric || data.tlyric?.lyric || undefined,
        roma: data.yromalrc?.lyric || data.romalrc?.lyric || undefined,
      });
    }
  }
  return candidates;
};

const fetchQQMusicCandidates = async (
  request: OnlineLyricMatchRequest,
  queries: string[],
): Promise<OnlineLyricCandidate[]> => {
  const candidates: OnlineLyricCandidate[] = [];
  const seen = new Set<number>();
  for (const query of queries) {
    const response = await qqMusicSearch(query, 1, 10);
    const songs = (response as any)?.songs ?? [];
    const metadata: SearchMetadata[] = songs
      .map((item: any) => ({
        id: Number(item.id),
        title: String(item.name ?? ""),
        artist: String(item.artist ?? ""),
        album: String(item.album ?? ""),
        durationMs: Number(item.duration) || 0,
      }))
      .filter(
        (item: SearchMetadata) => Number.isFinite(item.id) && item.id > 0 && Boolean(item.title),
      );
    for (const item of rankMetadata(metadata, request)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      let data: any = null;
      try {
        data = await qqMusicLyric(item.id, item.title, item.artist);
      } catch {
        continue;
      }
      if (!data || data.code !== 200) continue;
      candidates.push({
        source: "qq",
        title: item.title,
        artist: item.artist,
        album: item.album,
        durationMs: item.durationMs,
        qrc: data.qrc || undefined,
        lrc: data.lrc || undefined,
        trans: data.trans || undefined,
        roma: data.roma || undefined,
      });
    }
  }
  return candidates;
};

/* -------------------------------------------------------------------------- */
/*                                在线歌词解析                                 */
/* -------------------------------------------------------------------------- */

const shouldResolveOnlineLyric = (song: SongType): boolean => {
  return Boolean(song.name?.trim() && getSongArtistText(song).trim() && song.duration > 0);
};

/**
 * 按手机端来源顺序匹配一份高置信在线歌词
 */
export const resolveOnlineLyric = async (song: SongType): Promise<ResolvedOnlineLyric | null> => {
  if (!isElectron || song.type === "streaming" || !shouldResolveOnlineLyric(song)) return null;
  const artistName = getSongArtistText(song);
  const cacheKey = `${lyricCacheKey(song)}.online.json`;
  const cacheMissKey = `${cacheKey}|${song.name}|${artistName}|${song.duration}`;

  const cached = await readCacheText(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as CachedOnlineLyric;
      if (parsed?.version === ONLINE_CACHE_VERSION) {
        const resolved = buildCandidateLyric({ ...parsed, source: parsed.source }, song.duration);
        if (resolved) return resolved;
      }
    } catch {
      // 缓存损坏时继续网络匹配
    }
  }

  const missAt = onlineMissAt.get(cacheMissKey);
  if (missAt && Date.now() - missAt < ONLINE_MISS_RETRY_MS) return null;

  const request: OnlineLyricMatchRequest = {
    trackName: song.name,
    artistName,
    albumName: getSongAlbumText(song),
    durationMs: song.duration,
    allowArtistMismatch: isPlaceholderArtist(artistName),
  };
  const queries = buildSearchQueries(song.name, artistName);

  for (const source of ONLINE_SOURCE_ORDER) {
    let candidates: OnlineLyricCandidate[] = [];
    try {
      if (source === "lrclib") {
        candidates = await fetchLrcLibCandidates(song.name, artistName);
      } else if (source === "kugou") {
        candidates = await fetchKugouCandidates(request);
      } else if (source === "netease") {
        candidates = await fetchNeteaseCandidates(request, queries);
      } else {
        candidates = await fetchQQMusicCandidates(request, queries);
      }
    } catch (error) {
      console.warn(`在线歌词来源 ${source} 请求失败:`, error);
      continue;
    }
    const best = rankOnlineLyricCandidates(request, candidates).find(
      (match) => match.confidence === "HIGH",
    );
    if (!best) continue;
    const resolved = buildCandidateLyric(best.candidate, song.duration);
    if (!resolved) continue;
    const cachedPayload: CachedOnlineLyric = {
      version: ONLINE_CACHE_VERSION,
      source: best.candidate.source,
      title: best.candidate.title,
      artist: best.candidate.artist,
      album: best.candidate.album,
      durationMs: best.candidate.durationMs,
      lrc: best.candidate.lrc,
      yrc: best.candidate.yrc,
      qrc: best.candidate.qrc,
      trans: best.candidate.trans,
      roma: best.candidate.roma,
      plain: best.candidate.plain,
    };
    await writeCacheText(cacheKey, JSON.stringify(cachedPayload));
    onlineMissAt.delete(cacheMissKey);
    return resolved;
  }

  onlineMissAt.set(cacheMissKey, Date.now());
  return null;
};

/* -------------------------------------------------------------------------- */
/*                                AMLL TTML DB                                */
/* -------------------------------------------------------------------------- */

/** 与手机端一致的 AMLL 搜索结果打分 */
const scoreAmllSearchResult = (
  trackName: string,
  artistName: string,
  item: AmllSearchItem,
): number => {
  const requestedTitle = normalizeAmllText(trackName);
  if (!requestedTitle) return 0;
  const titleScore = (item.titles.length ? item.titles : [item.title])
    .map((title) => {
      const normalized = normalizeAmllText(title);
      if (!normalized) return 0;
      if (normalized === requestedTitle) return 90;
      if (normalized.startsWith(`${requestedTitle} `)) return 78;
      if (normalized.includes(requestedTitle) || requestedTitle.includes(normalized)) return 64;
      return amllTokenOverlap(requestedTitle, normalized) * 6;
    })
    .reduce((max, score) => Math.max(max, score), 0);

  const requestedArtists = splitAmllArtists(artistName);
  const artistScore = requestedArtists.length
    ? (item.artists.length ? item.artists : [item.artist])
        .map((artist) => {
          const normalized = normalizeAmllText(artist);
          return requestedArtists.reduce((max, requested) => {
            if (!normalized) return max;
            if (normalized === requested) return Math.max(max, 55);
            if (normalized.includes(requested) || requested.includes(normalized)) {
              return Math.max(max, 40);
            }
            return Math.max(max, amllTokenOverlap(requested, normalized) * 8);
          }, 0);
        })
        .reduce((max, score) => Math.max(max, score), 0)
    : 0;

  if (requestedArtists.length && artistScore < AMLL_MIN_ARTIST_SCORE) return 0;
  return titleScore + artistScore;
};

const normalizeAmllText = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:feat|ft|featuring)\.?\b/g, " ")
    .replace(/[(){}[\]【】（）]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

const splitAmllArtists = (value: string): string[] =>
  value
    .split(/[/,，、&+]|(?:\s+x\s+)/i)
    .map(normalizeAmllText)
    .filter(Boolean);

const amllTokenOverlap = (left: string, right: string): number => {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });
  return intersection;
};

/** TTML 末行常早于音频结束，负向容差要比正向宽松 */
const isAmllDurationCompatible = (expectedMs: number, candidateMs: number): boolean => {
  if (expectedMs <= 0 || candidateMs <= 0) return true;
  const deltaMs = candidateMs - expectedMs;
  const toleranceMs =
    deltaMs < 0
      ? Math.min(Math.max(30_000, Math.floor((expectedMs * 15) / 100)), 60_000)
      : Math.min(Math.max(12_000, Math.floor(expectedMs / 10)), 30_000);
  return Math.abs(deltaMs) <= toleranceMs;
};

const hasWordTiming = (lines: LyricLine[]): boolean =>
  lines.some(
    (line) =>
      line.words.length > 1 ||
      line.words.some((word) => (word.endTime ?? 0) - (word.startTime ?? 0) > 0),
  );

const estimateDurationMs = (lines: LyricLine[]): number =>
  lines.reduce((max, line) => Math.max(max, line.endTime || 0, line.startTime || 0), 0);

const parseAmllTtml = (raw: string, expectedDurationMs: number): LyricLine[] => {
  const lines = parseTTML(cleanTTMLTranslations(raw))?.lines ?? [];
  if (!lines.length || !hasWordTiming(lines)) return [];
  if (!isAmllDurationCompatible(expectedDurationMs, estimateDurationMs(lines))) return [];
  return lines;
};

/**
 * 从 AMLL TTML 数据库匹配逐字歌词
 */
export const resolveAmllLyric = async (song: SongType): Promise<ResolvedAmllLyric | null> => {
  if (!isElectron) return null;
  const trackName = song.name?.trim();
  const artistName = getSongArtistText(song).trim();
  if (!trackName || !artistName) return null;

  const cacheKey = `${lyricCacheKey(song)}.amll.ttml`;
  const cached = await readCacheText(cacheKey);
  if (cached) {
    const lines = parseAmllTtml(cached, song.duration);
    if (lines.length) return { lines, rawTtml: cached };
  }

  const results = (await window.electron.ipcRenderer.invoke(
    "external-lyric:amll-search",
    trackName,
  )) as AmllSearchItem[];
  const ranked = (results ?? [])
    .map((item) => ({ item, score: scoreAmllSearchResult(trackName, artistName, item) }))
    .filter((entry) => entry.score >= AMLL_MIN_QUERY_SCORE)
    .sort((left, right) => right.score - left.score || right.item.score - left.item.score)
    .slice(0, AMLL_MAX_CANDIDATES);

  for (const { item } of ranked) {
    const raw = (await window.electron.ipcRenderer.invoke("external-lyric:amll-raw", item.file)) as
      | string
      | null;
    if (!raw) continue;
    const lines = parseAmllTtml(raw, song.duration);
    if (!lines.length) continue;
    await writeCacheText(cacheKey, raw);
    return { lines, rawTtml: raw };
  }
  return null;
};

/** 读取缓存的 AMLL TTML，用于任务栏 BG 注入 */
export const readCachedAmllTtml = async (song: SongType): Promise<string | null> => {
  return readCacheText(`${lyricCacheKey(song)}.amll.ttml`);
};
