import { inflateSync } from "node:zlib";
import { windowsLog } from "../logger";

/**
 * 第三方在线歌词源服务
 * 移植自 Lyra 手机端的 LRCLIB / 酷狗 / AMLL TTML DB 客户端，
 * 放在主进程请求以避免渲染进程的跨域限制。
 */

const USER_AGENT = "Lyra/1.0 (https://github.com/cwuom/Lyra)";
const REQUEST_TIMEOUT_MS = 12_000;

const LRCLIB_BASE_URL = "https://lrclib.net/api";
const KUGOU_SEARCH_URL = "http://mobilecdn.kugou.com/api/v3/search/song";
const KUGOU_LYRIC_SEARCH_URL = "https://lyrics.kugou.com/search";
const KUGOU_LYRIC_DOWNLOAD_URL = "https://lyrics.kugou.com/download";
const AMLL_DB_BASE_URL = "https://amlldb.bikonoo.com";

const KUGOU_SEARCH_LIMIT = 8;
const KUGOU_MAX_QUERIES = 2;

const KUGOU_KRC_HEADER_BYTES = 4;
const KUGOU_KRC_KEY = Uint8Array.from([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
]);

/** 通用歌词候选（LRCLIB / 酷狗） */
export interface ExternalLyricCandidate {
  source: "lrclib" | "kugou";
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  /** 逐字歌词（酷狗 KRC 转 YRC） */
  yrc?: string;
  /** 逐行歌词 */
  lrc?: string;
  /** 翻译歌词 */
  trans?: string;
  /** 无时间轴纯文本歌词 */
  plain?: string;
}

/** 酷狗歌曲搜索结果 */
export interface KugouSongSearchResult {
  id: string;
  hash: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
}

/** AMLL TTML 搜索结果 */
export interface AmllSearchResult {
  file: string;
  title: string;
  titles: string[];
  artist: string;
  artists: string[];
  albums: string[];
  ncmIds: string[];
  qqIds: string[];
  score: number;
}

const fetchText = async (url: string, init?: RequestInit): Promise<string | null> => {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, ...(init?.headers as Record<string, string>) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      windowsLog.warn(`External lyric request returned ${response.status}: ${url}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    windowsLog.warn(`External lyric request failed: ${url} (${(error as Error).message})`);
    return null;
  }
};

const parseJson = <T>(text: string | null): T | null => {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

/* -------------------------------------------------------------------------- */
/*                                    LRCLIB                                  */
/* -------------------------------------------------------------------------- */

interface LrcLibRawResult {
  trackName?: string;
  artistName?: string;
  duration?: number;
  syncedLyrics?: string;
  plainLyrics?: string;
}

/** 与手机端一致的查询词：歌名+歌手、歌名 */
const buildLrcLibQueries = (trackName: string, artistName: string): string[] => {
  const track = trackName.trim();
  const artist = artistName.trim();
  const queries = [artist ? `${track} ${artist}` : "", track].filter(Boolean);
  return [...new Set(queries)];
};

/**
 * LRCLIB 搜索歌词
 */
export const searchLrcLibLyrics = async (
  trackName: string,
  artistName: string,
): Promise<ExternalLyricCandidate[]> => {
  const candidates: ExternalLyricCandidate[] = [];
  const seen = new Set<string>();
  for (const query of buildLrcLibQueries(trackName, artistName).slice(0, 2)) {
    const text = await fetchText(`${LRCLIB_BASE_URL}/search?q=${encodeURIComponent(query)}`);
    const results = parseJson<LrcLibRawResult[]>(text);
    if (!Array.isArray(results)) continue;
    for (const item of results) {
      const durationSeconds = Number(item.duration);
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) continue;
      const syncedLyrics = item.syncedLyrics?.trim() || undefined;
      const plainLyrics = item.plainLyrics?.trim() || undefined;
      if (!syncedLyrics && !plainLyrics) continue;
      const key = `${item.trackName}|${item.artistName}|${durationSeconds}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        source: "lrclib",
        title: item.trackName ?? "",
        artist: item.artistName ?? "",
        durationMs: Math.round(durationSeconds * 1000),
        lrc: syncedLyrics,
        plain: syncedLyrics ? undefined : plainLyrics,
      });
    }
  }
  return candidates;
};

/* -------------------------------------------------------------------------- */
/*                                    酷狗                                     */
/* -------------------------------------------------------------------------- */

const buildKugouQueries = (trackName: string, artistName: string): string[] => {
  const track = trackName.trim();
  const artist = artistName.trim();
  const queries = [artist ? `${track} ${artist}` : "", track].filter(Boolean);
  return [...new Set(queries)];
};

interface KugouSearchResponse {
  data?: {
    info?: Array<{
      hash?: string;
      songname?: string;
      singername?: string;
      album_name?: string;
      duration?: number;
      album_audio_id?: number;
      audio_id?: number;
    }>;
  };
}

/**
 * 酷狗歌曲搜索
 */
export const searchKugouSongs = async (
  trackName: string,
  artistName: string,
): Promise<KugouSongSearchResult[]> => {
  const results = new Map<string, KugouSongSearchResult>();
  for (const query of buildKugouQueries(trackName, artistName).slice(0, KUGOU_MAX_QUERIES)) {
    const url =
      `${KUGOU_SEARCH_URL}?format=json&keyword=${encodeURIComponent(query)}` +
      `&page=1&pagesize=${KUGOU_SEARCH_LIMIT}&showtype=1`;
    const response = parseJson<KugouSearchResponse>(await fetchText(url));
    const items = response?.data?.info;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const hash = item.hash?.trim();
      const title = item.songname?.trim();
      const artist = item.singername?.trim();
      if (!hash || !title || !artist) continue;
      if (results.has(hash)) continue;
      const durationSeconds = Number(item.duration) || 0;
      results.set(hash, {
        id: String(item.album_audio_id ?? item.audio_id ?? 0),
        hash,
        title,
        artist,
        album: item.album_name?.trim() || undefined,
        durationMs: durationSeconds > 0 ? durationSeconds * 1000 : 0,
      });
    }
  }
  return [...results.values()];
};

interface KugouLyricCandidate {
  id: string;
  accessKey: string;
  durationMs: number;
  score: number;
}

const parseKugouLyricCandidates = (body: string | null): KugouLyricCandidate[] => {
  const response = parseJson<{ candidates?: any[] }>(body);
  const candidates = response?.candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates
    .map((item) => ({
      id: String(item?.id ?? "").trim(),
      accessKey: String(item?.accesskey ?? "").trim(),
      durationMs: Number(item?.duration) || 0,
      score: Number(item?.score) || 0,
    }))
    .filter((item) => item.id && item.accessKey);
};

/** 解压酷狗 KRC：去掉 4 字节头，按固定密钥异或，再 zlib 解压 */
const decryptKugouKrc = (encrypted: Buffer): string | null => {
  if (encrypted.length <= KUGOU_KRC_HEADER_BYTES) return null;
  const payload = encrypted.subarray(KUGOU_KRC_HEADER_BYTES);
  const decrypted = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    decrypted[index] = payload[index] ^ KUGOU_KRC_KEY[index % KUGOU_KRC_KEY.length];
  }
  try {
    return inflateSync(decrypted).toString("utf8").trim() || null;
  } catch {
    return null;
  }
};

const KUGOU_KRC_LINE_REGEX = /^\[(\d+),\s*(\d+)](.*)$/;
const KUGOU_KRC_SEGMENT_REGEX = /<(\d+),\s*(\d+),\s*[-\d]+>([^<\n\r]*)/g;

/** 酷狗 KRC 转为网易云 YRC 文本，便于复用现有逐字解析 */
const convertKugouKrcToYrc = (krc: string): string => {
  const lines: string[] = [];
  for (const rawLine of krc.split(/\r?\n/)) {
    const header = KUGOU_KRC_LINE_REGEX.exec(rawLine.trim());
    if (!header) continue;
    const lineStartMs = Number(header[1]);
    const lineDurationMs = Number(header[2]);
    const content = header[3];
    let output = `[${lineStartMs},${lineDurationMs}]`;
    let matched = false;
    KUGOU_KRC_SEGMENT_REGEX.lastIndex = 0;
    let segment = KUGOU_KRC_SEGMENT_REGEX.exec(content);
    while (segment) {
      const wordOffsetMs = Number(segment[1]);
      const wordDurationMs = Number(segment[2]);
      output += `(${lineStartMs + wordOffsetMs},${wordDurationMs},0)${segment[3]}`;
      matched = true;
      segment = KUGOU_KRC_SEGMENT_REGEX.exec(content);
    }
    if (matched) lines.push(output);
  }
  return lines.join("\n");
};

const KUGOU_KRC_TAG_REGEX = /^\[(\w+):([^\]]*)\]$/;

const decodeBase64Utf8 = (value: string): string | null => {
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return null;
  }
};

const formatLrcTimestamp = (startMs: number): string => {
  const minutes = Math.floor(startMs / 60_000);
  const seconds = Math.floor((startMs % 60_000) / 1000);
  const centis = Math.floor((startMs % 1000) / 10);
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
    centis,
  ).padStart(2, "0")}]`;
};

/** 从 KRC 的 language 标签中提取翻译歌词 */
const extractKugouKrcTranslation = (krc: string): string | null => {
  const timedLines: Array<{ startMs: number }> = [];
  let languageTag: string | null = null;
  for (const rawLine of krc.split(/\r?\n/)) {
    const line = rawLine.trim();
    const timed = KUGOU_KRC_LINE_REGEX.exec(line);
    if (timed) {
      timedLines.push({ startMs: Number(timed[1]) });
      continue;
    }
    const tag = KUGOU_KRC_TAG_REGEX.exec(line);
    if (tag && tag[1] === "language") {
      languageTag = tag[2];
    }
  }
  if (!languageTag || timedLines.length === 0) return null;
  const decoded = decodeBase64Utf8(languageTag);
  if (!decoded) return null;
  const content = parseJson<{ content?: any[] }>(decoded)?.content;
  if (!Array.isArray(content)) return null;
  const translation = content.find((item) => Number(item?.type) === 1);
  const lyricContent = translation?.lyricContent;
  if (!Array.isArray(lyricContent)) return null;
  const lines: string[] = [];
  timedLines.forEach((timedLine, index) => {
    const value = lyricContent[index];
    const text = Array.isArray(value)
      ? value
          .map((part) => String(part ?? "").trim())
          .filter(Boolean)
          .join(" ")
      : String(value ?? "").trim();
    if (text) lines.push(`${formatLrcTimestamp(timedLine.startMs)}${text}`);
  });
  return lines.length ? lines.join("\n") : null;
};

/**
 * 拉取酷狗歌词：优先 KRC 逐字，失败后回退 LRC
 */
export const fetchKugouLyric = async (
  song: KugouSongSearchResult,
): Promise<Pick<ExternalLyricCandidate, "yrc" | "lrc" | "trans">> => {
  const params =
    `?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(`${song.artist} - ${song.title}`)}` +
    `&duration=${song.durationMs}&hash=${encodeURIComponent(song.hash)}`;
  const candidates = parseKugouLyricCandidates(
    await fetchText(`${KUGOU_LYRIC_SEARCH_URL}${params}`),
  ).sort(
    (left, right) =>
      right.score - left.score ||
      Math.abs(left.durationMs - song.durationMs) - Math.abs(right.durationMs - song.durationMs),
  );
  for (const candidate of candidates) {
    const krcText = await fetchText(
      `${KUGOU_LYRIC_DOWNLOAD_URL}?ver=1&client=mobi&id=${encodeURIComponent(
        candidate.id,
      )}&accesskey=${encodeURIComponent(candidate.accessKey)}&fmt=krc&charset=utf8`,
    );
    const krcPayload = parseJson<{
      status?: number;
      error_code?: number;
      content?: string;
    }>(krcText);
    if (!krcPayload?.content) continue;
    const krc = decryptKugouKrc(Buffer.from(krcPayload.content, "base64"));
    if (!krc) continue;
    const yrc = convertKugouKrcToYrc(krc);
    if (!yrc) continue;
    return { yrc, trans: extractKugouKrcTranslation(krc) ?? undefined };
  }
  for (const candidate of candidates) {
    const lrcText = await fetchText(
      `${KUGOU_LYRIC_DOWNLOAD_URL}?ver=1&client=pc&id=${encodeURIComponent(
        candidate.id,
      )}&accesskey=${encodeURIComponent(candidate.accessKey)}&fmt=lrc&charset=utf8`,
    );
    const lrcPayload = parseJson<{
      status?: number;
      error_code?: number;
      content?: string;
    }>(lrcText);
    if (!lrcPayload?.content) continue;
    const decoded = Buffer.from(lrcPayload.content, "base64")
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .trim();
    if (decoded) return { lrc: decoded };
  }
  return {};
};

/* -------------------------------------------------------------------------- */
/*                                AMLL TTML DB                                */
/* -------------------------------------------------------------------------- */

const readStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
};

/**
 * AMLL TTML DB 搜索
 */
export const searchAmllLyrics = async (trackName: string): Promise<AmllSearchResult[]> => {
  const query = trackName.trim();
  if (!query) return [];
  const body = await fetchText(`${AMLL_DB_BASE_URL}/api/search-lyrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ query, type: "title" }),
  });
  const raw = parseJson<Array<Record<string, unknown>>>(body);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      file: String(item?.file ?? "").trim(),
      title: String(item?.title ?? "").trim(),
      titles: readStringArray(item?.titles),
      artist: String(item?.artist ?? "").trim(),
      artists: readStringArray(item?.artists),
      albums: readStringArray(item?.albums),
      ncmIds: readStringArray(item?.ncmIds),
      qqIds: readStringArray(item?.qqIds),
      score: Number(item?.score) || 0,
    }))
    .filter((item) => item.file.endsWith(".ttml") && !item.file.includes("/"));
};

/**
 * 拉取 AMLL TTML 原始内容
 */
export const fetchAmllTtml = async (file: string): Promise<string | null> => {
  const safeFile = file.trim();
  if (!safeFile.endsWith(".ttml") || safeFile.includes("/")) return null;
  const text = await fetchText(`${AMLL_DB_BASE_URL}/raw-lyrics/${encodeURIComponent(safeFile)}`);
  return text?.trim() ? text : null;
};
