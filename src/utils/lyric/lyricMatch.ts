/**
 * 在线歌词匹配规则
 * 移植自 Lyra 手机端的 EditableLyricMatchPolicy / ExternalLyricMatchPolicy，
 * 保持标题、歌手、时长与置信度的判定与手机端一致。
 */

export type OnlineLyricSource = "lrclib" | "kugou" | "netease" | "qq";

/** 在线歌词候选 */
export interface OnlineLyricCandidate {
  source: OnlineLyricSource;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  /** 逐字歌词（YRC 或酷狗 KRC 转换后的 YRC） */
  yrc?: string;
  /** QQ 音乐 QRC 逐字歌词 */
  qrc?: string;
  /** 逐行歌词 */
  lrc?: string;
  /** 翻译歌词 */
  trans?: string;
  /** 音译歌词 */
  roma?: string;
  /** 无时间轴纯文本歌词 */
  plain?: string;
}

export type OnlineLyricConfidence = "HIGH" | "MEDIUM" | "LOW";

/** 参与打分的歌词匹配请求 */
export interface OnlineLyricMatchRequest {
  trackName: string;
  artistName: string;
  albumName?: string;
  durationMs: number;
  allowArtistMismatch?: boolean;
}

/** 排序后的匹配结果 */
export interface RankedOnlineLyricMatch {
  candidate: OnlineLyricCandidate;
  score: number;
  durationDeltaMs: number;
  confidence: OnlineLyricConfidence;
}

const MIN_MATCH_SCORE = 35;
const MIN_RELIABLE_TITLE_SCORE = 52;
const MIN_RELIABLE_ARTIST_SCORE = 24;
const MIN_EXTERNAL_DURATION_TOLERANCE_MS = 7_000;
const MAX_EXTERNAL_DURATION_TOLERANCE_MS = 15_000;
const EXTERNAL_DURATION_TOLERANCE_PERCENT = 6;

const WHITESPACE_REGEX = /\s+/g;
const HARD_ARTIST_SEPARATOR_REGEX = /[/,，、&+]|\s+[xX]\s+/;
const FEATURED_ARTIST_SEPARATOR_REGEX = /\b(?:feat\.?|ft\.?|featuring)\b/i;
const VERSION_MODIFIER_REGEX =
  /\b(?:remaster(?:ed)?|remix|live|acoustic|instrumental|karaoke|demo|cover|rework|slowed|sped\s+up|version|edit|extended|radio|clean|explicit)\b/g;
const TITLE_NOISE_SUFFIX_REGEX =
  /(?:\s+|^)(?:official|audio|video|lyrics?|visualizer|hd|hq|4k|mv|官方|官方版|官方视频|音频|歌词|歌词版|高清|完整版)(?:\s+(?:official|audio|video|lyrics?|visualizer|hd|hq|4k|mv|官方|官方版|官方视频|音频|歌词|歌词版|高清|完整版))*$/;
const PLACEHOLDER_ARTISTS = new Set([
  "",
  "unknown",
  "unknown artist",
  "未知",
  "未知歌手",
  "未知艺术家",
]);

/** 标准化匹配文本：全半角归一、小写、去掉合作演唱标记与括号 */
export const normalizeLyricMatchText = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:feat|ft|featuring)\.?\b/g, " ")
    .replace(/[()[\]{}【】（）]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(WHITESPACE_REGEX, " ");

const tokenOverlapRatio = (left: string, right: string): number => {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });
  return intersection / Math.max(leftTokens.size, rightTokens.size);
};

const versionSignature = (value: string): string => {
  const modifiers = normalizeLyricMatchText(value).match(VERSION_MODIFIER_REGEX) ?? [];
  return [...new Set(modifiers.map((item) => (item === "remastered" ? "remaster" : item)))]
    .sort()
    .join("|");
};

const canonicalTitle = (value: string): string =>
  normalizeLyricMatchText(value)
    .replace(TITLE_NOISE_SUFFIX_REGEX, " ")
    .replace(VERSION_MODIFIER_REGEX, " ")
    .replace(WHITESPACE_REGEX, " ")
    .trim();

const splitArtists = (value: string): string[] => {
  const whole = normalizeLyricMatchText(value);
  const segments = value
    .split(FEATURED_ARTIST_SEPARATOR_REGEX)
    .flatMap((segment) => segment.split(HARD_ARTIST_SEPARATOR_REGEX))
    .map(normalizeLyricMatchText)
    .filter(Boolean);
  return [...new Set([whole, ...segments].filter(Boolean))];
};

const primaryArtist = (value: string): string => {
  const segments = value
    .split(FEATURED_ARTIST_SEPARATOR_REGEX)
    .flatMap((segment) => segment.split(HARD_ARTIST_SEPARATOR_REGEX))
    .map(normalizeLyricMatchText)
    .filter(Boolean);
  return segments[0] ?? "";
};

const hasPrimaryArtist = (expected: string, candidate: string): boolean => {
  const expectedPrimary = primaryArtist(expected);
  if (!expectedPrimary) return false;
  return splitArtists(candidate).includes(expectedPrimary);
};

export const isPlaceholderArtist = (artist: string): boolean =>
  PLACEHOLDER_ARTISTS.has(artist.trim().toLowerCase());

/** 标题相似度 */
export const scoreLyricTitle = (expected: string, candidate: string): number => {
  const expectedText = normalizeLyricMatchText(expected);
  const candidateText = normalizeLyricMatchText(candidate);
  if (!expectedText || !candidateText) return 0;
  if (candidateText === expectedText) return 80;
  if (candidateText.startsWith(`${expectedText} `)) return 68;
  if (expectedText.startsWith(`${candidateText} `)) return 62;
  if (candidateText.includes(expectedText) || expectedText.includes(candidateText)) return 52;
  return Math.round(tokenOverlapRatio(expectedText, candidateText) * 44);
};

/** 歌手相似度 */
export const scoreLyricArtist = (expected: string, candidate: string): number => {
  const expectedArtists = splitArtists(expected);
  const candidateArtists = splitArtists(candidate);
  if (!expectedArtists.length || !candidateArtists.length) return 0;
  const expectedSet = new Set(expectedArtists);
  const candidateSet = new Set(candidateArtists);
  if (
    expectedArtists.length === candidateArtists.length &&
    expectedArtists.every((a) => candidateSet.has(a))
  ) {
    return 55;
  }
  if (expectedArtists.every((artist) => candidateSet.has(artist))) return 46;
  const intersectionSize = expectedArtists.filter((artist) => candidateSet.has(artist)).length;
  if (intersectionSize > 0) {
    return 28 + Math.floor((18 * intersectionSize) / Math.max(expectedArtists.length, 1));
  }
  let best = 0;
  expectedSet.forEach((expectedArtist) => {
    candidateSet.forEach((candidateArtist) => {
      const contained = candidateArtist.startsWith(`${expectedArtist} `);
      best = Math.max(
        best,
        contained ? 24 : Math.round(tokenOverlapRatio(expectedArtist, candidateArtist) * 20),
      );
    });
  });
  return best;
};

/** 专辑相似度 */
export const scoreLyricAlbum = (expected?: string, candidate?: string): number => {
  const expectedAlbum = normalizeLyricMatchText(expected ?? "");
  const candidateAlbum = normalizeLyricMatchText(candidate ?? "");
  if (!expectedAlbum || !candidateAlbum) return 0;
  if (expectedAlbum === candidateAlbum) return 8;
  if (expectedAlbum.includes(candidateAlbum) || candidateAlbum.includes(expectedAlbum)) return 4;
  return 0;
};

/** 时长是否在手机端容差内（7s / 6% / 上限 15s） */
export const isExternalLyricDurationCompatible = (
  expectedDurationMs: number,
  candidateDurationMs: number,
): boolean => {
  if (expectedDurationMs <= 0 || candidateDurationMs <= 0) return false;
  const toleranceMs = Math.min(
    Math.max(
      MIN_EXTERNAL_DURATION_TOLERANCE_MS,
      Math.floor((expectedDurationMs * EXTERNAL_DURATION_TOLERANCE_PERCENT) / 100),
    ),
    MAX_EXTERNAL_DURATION_TOLERANCE_MS,
  );
  return Math.abs(expectedDurationMs - candidateDurationMs) <= toleranceMs;
};

/** 时长相似度 */
export const scoreLyricDuration = (
  expectedDurationMs: number,
  candidateDurationMs: number,
): number => {
  if (expectedDurationMs <= 0 || candidateDurationMs <= 0) return 0;
  const deltaMs = Math.abs(expectedDurationMs - candidateDurationMs);
  if (isExternalLyricDurationCompatible(expectedDurationMs, candidateDurationMs)) {
    return Math.max(42 - Math.floor(deltaMs / 500), 22);
  }
  return -Math.min(Math.floor(deltaMs / 3000), 48);
};

/** 歌名与主歌手都可靠一致 */
export const isReliableLyricMatchIdentity = (
  expectedTitle: string,
  expectedArtist: string,
  candidateTitle: string,
  candidateArtist: string,
): boolean => {
  if (!expectedTitle || !expectedArtist || !candidateTitle || !candidateArtist) return false;
  if (versionSignature(expectedTitle) !== versionSignature(candidateTitle)) return false;
  return (
    hasPrimaryArtist(expectedArtist, candidateArtist) &&
    canonicalTitle(expectedTitle) === canonicalTitle(candidateTitle) &&
    scoreLyricTitle(expectedTitle, candidateTitle) >= MIN_RELIABLE_TITLE_SCORE &&
    scoreLyricArtist(expectedArtist, candidateArtist) >= MIN_RELIABLE_ARTIST_SCORE
  );
};

const isPlausibleIdentity = (
  request: OnlineLyricMatchRequest,
  candidate: OnlineLyricCandidate,
  durationCompatible: boolean,
): boolean => {
  if (
    isReliableLyricMatchIdentity(
      request.trackName,
      request.artistName,
      candidate.title,
      candidate.artist,
    )
  ) {
    return true;
  }
  const titleScore = scoreLyricTitle(request.trackName, candidate.title);
  if (request.allowArtistMismatch && titleScore >= MIN_RELIABLE_TITLE_SCORE) return true;
  const artistScore = scoreLyricArtist(request.artistName, candidate.artist);
  const candidateHasNoArtist = !normalizeLyricMatchText(candidate.artist);
  return (
    (hasPrimaryArtist(request.artistName, candidate.artist) &&
      titleScore >= 20 &&
      durationCompatible) ||
    (titleScore >= MIN_RELIABLE_TITLE_SCORE && durationCompatible && candidateHasNoArtist) ||
    (titleScore >= 20 && artistScore >= MIN_RELIABLE_ARTIST_SCORE && durationCompatible)
  );
};

const candidateQualityScore = (candidate: OnlineLyricCandidate): number => {
  const formatScore = candidate.yrc || candidate.qrc ? 14 : candidate.lrc ? 10 : 2;
  const translationScore = candidate.trans ? 5 : 0;
  const sourceScore = candidate.source === "lrclib" ? 2 : 4;
  return formatScore + translationScore + sourceScore;
};

/** 按手机端规则打分、过滤并排序 */
export const rankOnlineLyricCandidates = (
  request: OnlineLyricMatchRequest,
  candidates: OnlineLyricCandidate[],
): RankedOnlineLyricMatch[] => {
  return candidates
    .filter((candidate) =>
      Boolean(candidate.lrc || candidate.yrc || candidate.qrc || candidate.plain),
    )
    .map((candidate) => {
      const titleScore = scoreLyricTitle(request.trackName, candidate.title);
      const artistScore = scoreLyricArtist(request.artistName, candidate.artist);
      const albumScore = scoreLyricAlbum(request.albumName, candidate.album);
      const durationScore = scoreLyricDuration(request.durationMs, candidate.durationMs);
      const durationCompatible =
        request.durationMs <= 0 ||
        candidate.durationMs <= 0 ||
        isExternalLyricDurationCompatible(request.durationMs, candidate.durationMs);
      const reliable = isReliableLyricMatchIdentity(
        request.trackName,
        request.artistName,
        candidate.title,
        candidate.artist,
      );
      const score =
        titleScore +
        artistScore +
        albumScore +
        durationScore +
        candidateQualityScore(candidate) +
        (reliable ? 10 : 0);
      const confidence: OnlineLyricConfidence =
        reliable && durationCompatible
          ? "HIGH"
          : titleScore >= 20 && artistScore >= MIN_RELIABLE_ARTIST_SCORE && durationCompatible
            ? "MEDIUM"
            : "LOW";
      return {
        candidate,
        score,
        durationDeltaMs:
          request.durationMs > 0 && candidate.durationMs > 0
            ? Math.abs(request.durationMs - candidate.durationMs)
            : Number.MAX_SAFE_INTEGER,
        confidence,
        plausible: isPlausibleIdentity(request, candidate, durationCompatible),
      };
    })
    .filter((match) => match.plausible && match.score >= MIN_MATCH_SCORE)
    .sort(
      (left, right) =>
        confidenceRank(right.confidence) - confidenceRank(left.confidence) ||
        right.score - left.score ||
        left.durationDeltaMs - right.durationDeltaMs,
    )
    .map(({ plausible: _plausible, ...match }) => match);
};

const confidenceRank = (confidence: OnlineLyricConfidence): number =>
  confidence === "HIGH" ? 3 : confidence === "MEDIUM" ? 2 : 1;
