import { DESKTOP_UA, encode, getJson, getText, mapLimit } from "./net";

/** 平台搜索结果 */
export interface PlatformSong {
  platformId: string;
  name: string;
  artist: string;
  album: string;
  albumId?: string;
  albumAudioId?: string;
  durationMs: number;
  hash?: string;
  coverUrl?: string;
}

/** 原曲匹配信息 */
export interface MatchInfo {
  songName: string;
  artist: string;
  durationMs: number;
}

const nonTextRegex = /[^\p{L}\p{N}]+/gu;
const artistSplitRegex = /[/、,，&＆;；]|\b(?:feat|ft|with)\b\.?/gi;
const artistAliasRegex = /[（([【][^)）\]】]*[)）\]】]/g;

const decodeEntities = (value: string): string =>
  String(value)
    .replace(/\\u0026/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));

const compactText = (value: string): string =>
  decodeEntities(value).toLowerCase().replace(nonTextRegex, "").trim();

const looseTitle = (value: string): string =>
  decodeEntities(value).toLowerCase().replace(/\s+/g, " ").trim();

const isTitleMatch = (target: string, candidate: string): { match: boolean; loose: boolean } => {
  const targetCompact = compactText(target);
  const candidateCompact = compactText(candidate);
  if (targetCompact.length < 2) return { match: false, loose: false };
  if (targetCompact === candidateCompact) return { match: true, loose: false };
  const rawTarget = looseTitle(target);
  const rawCandidate = looseTitle(candidate);
  if (!rawCandidate.startsWith(rawTarget)) return { match: false, loose: false };
  const rest = rawCandidate.slice(rawTarget.length).trim();
  if (!/^(?:[（(【]|\[)/.test(rest)) return { match: false, loose: false };
  if (/伴奏|纯音乐|instrumental|karaoke/i.test(rest)) return { match: false, loose: false };
  return { match: true, loose: true };
};

const artistTokens = (value: string): string[] =>
  value
    .replace(artistAliasRegex, " ")
    .split(artistSplitRegex)
    .map((item) => compactText(item))
    .filter((item) => item.length > 0);

/** 歌名匹配 + 歌手命中 + 时长误差 12 秒内 */
export const scoreCandidate = (match: MatchInfo, candidate: PlatformSong): number => {
  const title = isTitleMatch(match.songName, candidate.name);
  if (!title.match) return -1;

  const targets = artistTokens(match.artist);
  const candidates = artistTokens(candidate.artist);
  if (targets.length === 0 || candidates.length === 0) return -1;
  if (!targets.some((token) => candidates.includes(token))) return -1;

  let durationScore = 10;
  if (match.durationMs > 0) {
    if (candidate.durationMs <= 0) {
      durationScore = 6;
    } else {
      const diff = Math.abs(candidate.durationMs - match.durationMs);
      if (diff > 12000) return -1;
      durationScore = diff <= 2000 ? 30 : diff <= 5000 ? 20 : 12;
    }
  }
  return (title.loose ? 96 : 120) + durationScore;
};

/** 选出最匹配的候选 */
export const pickBest = (match: MatchInfo, list: PlatformSong[]): PlatformSong | null => {
  let best: PlatformSong | null = null;
  let bestScore = 0;
  for (const item of list) {
    const score = scoreCandidate(match, item);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
};

/** 网易云搜索（用于无歌曲 id 时的音源兜底） */
export const searchNetease = async (keyword: string): Promise<PlatformSong[]> => {
  const url =
    "https://music.163.com/api/search/get?s=" + encode(keyword) + "&type=1&limit=30&offset=0";
  const data = await getJson<any>(url, { Referer: "https://music.163.com/" });
  const list: any[] = data?.result?.songs ?? [];
  return list
    .map<PlatformSong | null>((item) => {
      const id = item?.id;
      if (id == null || !item?.name) return null;
      const album = item?.album ?? item?.al;
      const artists = item?.artists ?? item?.ar;
      return {
        platformId: String(id),
        name: String(item.name),
        artist: Array.isArray(artists)
          ? artists
              .map((entry: any) => entry?.name)
              .filter(Boolean)
              .join(" / ")
          : "",
        album: String(album?.name ?? ""),
        albumId: album?.id != null ? String(album.id) : undefined,
        durationMs: Number(item?.duration ?? item?.dt ?? 0),
        coverUrl: album?.picUrl || undefined,
      };
    })
    .filter((item): item is PlatformSong => item !== null);
};

/** 酷我搜索 */
export const searchKuwo = async (keyword: string): Promise<PlatformSong[]> => {
  const url =
    "http://search.kuwo.cn/r.s?all=" +
    encode(keyword) +
    "&ft=music&itemset=web_2013&client=kt&pn=0&rn=30&rformat=json&encoding=utf8";
  const text = await getText(url);
  if (!text) return [];
  try {
    const data = JSON.parse(text.replace(/'/g, '"'));
    const list: any[] = data?.abslist ?? [];
    return list
      .filter((item) => item?.MUSICRID && item?.NAME)
      .map((item) => ({
        platformId: String(item.MUSICRID),
        name: decodeEntities(String(item.NAME)),
        artist: decodeEntities(String(item.ARTIST ?? "")),
        album: decodeEntities(String(item.ALBUM ?? "")),
        albumId: item.ALBUMID ? String(item.ALBUMID) : undefined,
        durationMs: Number(item.DURATION ?? 0) * 1000,
        coverUrl: item.web_albumpic_short
          ? `https://img1.kuwo.cn/star/albumcover/${item.web_albumpic_short}`
          : undefined,
      }));
  } catch {
    return [];
  }
};

/** 酷狗搜索 */
export const searchKugou = async (keyword: string): Promise<PlatformSong[]> => {
  const url =
    "http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=" +
    encode(keyword) +
    "&page=1&pagesize=30&showtype=1";
  const data = await getJson<any>(url);
  const list: any[] = data?.data?.info ?? [];
  return list
    .filter((item) => item?.hash && item?.songname)
    .map((item) => ({
      platformId: String(item.hash),
      hash: String(item.hash),
      name: decodeEntities(String(item.songname)),
      artist: decodeEntities(String(item.singername ?? "")),
      album: decodeEntities(String(item.album_name ?? "")),
      albumId: item.album_id ? String(item.album_id) : undefined,
      albumAudioId: item.album_audio_id ? String(item.album_audio_id) : undefined,
      durationMs: Number(item.duration ?? 0) * 1000,
      coverUrl: item?.trans_param?.union_cover
        ? String(item.trans_param.union_cover).replace("{size}", "240")
        : undefined,
    }));
};

/** 咪咕搜索 */
export const searchMigu = async (keyword: string): Promise<PlatformSong[]> => {
  const url =
    "https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?text=" +
    encode(keyword) +
    "&pageNo=1&pageSize=30&isCopyright=1&sort=1&searchSwitch=%7B%22song%22%3A1%7D";
  const data = await getJson<any>(url, { Referer: "https://m.music.migu.cn/" });
  const list: any[] = data?.songResultData?.result ?? [];
  const songs: PlatformSong[] = list
    .filter((item) => item?.copyrightId && item?.name)
    .map((item) => {
      const singers = Array.isArray(item.singers)
        ? item.singers.map((singer: any) => singer?.name).filter(Boolean)
        : [];
      const album = item.albums?.[0];
      return {
        platformId: String(item.copyrightId),
        name: decodeEntities(String(item.name)),
        artist: singers.join(" / "),
        album: String(album?.name ?? ""),
        albumId: album?.id ? String(album.id) : undefined,
        albumAudioId: item.contentId ? String(item.contentId) : undefined,
        durationMs: 0,
      };
    });
  return mapLimit(songs, 6, async (song) => {
    if (!song.albumAudioId) return song;
    const detail = await getJson<any>(
      "https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do" +
        `?resourceType=2&resourceId=${encode(song.albumAudioId)}`,
      { Referer: "https://m.music.migu.cn/" },
    );
    const resource = detail?.resource?.[0];
    if (!resource) return song;
    return { ...song, durationMs: parseClock(resource.length) || song.durationMs };
  });
};

/** QQ 音乐搜索 */
export const searchTencent = async (keyword: string): Promise<PlatformSong[]> => {
  const headers = { Referer: "https://y.qq.com/" };
  const legacy =
    "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?ct=24&qqmusic_ver=1298" +
    "&new_json=1&remoteplace=txt.yqq.song&searchid=0&t=0&aggr=1&cr=1&catZhida=1" +
    "&lossless=0&flag_qc=0&p=1&n=30&w=" +
    encode(keyword) +
    "&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8" +
    "&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0";
  const data = await getJson<any>(legacy, headers);
  if (data) {
    const list: any[] = data?.data?.song?.list ?? [];
    const mapped = list.map<PlatformSong | null>((item) => {
      const mid = item?.mid ?? item?.songmid;
      if (!mid || !item?.name) return null;
      const singers = Array.isArray(item.singer)
        ? item.singer.map((singer: any) => singer?.name).filter(Boolean)
        : [];
      const album = item.album ?? {};
      const albumMid = album.mid ?? item.albummid;
      return {
        platformId: String(mid),
        name: decodeEntities(String(item.name ?? item.title)),
        artist: singers.join(" / "),
        album: String(album.name ?? item.albumname ?? ""),
        albumId: album.id ? String(album.id) : undefined,
        albumAudioId: item.id ? String(item.id) : undefined,
        durationMs: Number(item.interval ?? 0) * 1000,
        coverUrl: albumMid
          ? `https://y.qq.com/music/photo_new/T002R800x800M000${albumMid}.jpg`
          : undefined,
      };
    });
    const valid = mapped.filter((item): item is PlatformSong => item !== null);
    if (valid.length) return valid;
  }

  // 兜底：旧版手机搜索接口
  const fallback =
    "https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?format=json" +
    `&n=30&p=1&w=${encode(keyword)}&g_tk=5381`;
  const legacyData = await getJson<any>(fallback, headers);
  const list: any[] = legacyData?.data?.song?.list ?? [];
  return list
    .filter((item) => item?.songmid && item?.songname)
    .map((item) => {
      const singers = Array.isArray(item.singer)
        ? item.singer.map((singer: any) => singer?.name).filter(Boolean)
        : [];
      return {
        platformId: String(item.songmid),
        name: decodeEntities(String(item.songname)),
        artist: singers.join(" / "),
        album: String(item.albumname ?? ""),
        albumId: item.albumid ? String(item.albumid) : undefined,
        albumAudioId: item.songid ? String(item.songid) : undefined,
        durationMs: Number(item.interval ?? 0) * 1000,
      };
    });
};

/** B 站视频标题匹配（标题包含歌名 + 歌手或 UP 主命中） */
export const pickBilibiliCandidate = (
  match: MatchInfo,
  list: { platformId: string; name: string; artist: string; durationMs: number }[],
): string | null => {
  const targetTitle = compactText(match.songName);
  const targets = artistTokens(match.artist);
  let best: { id: string; score: number } | null = null;
  for (const item of list) {
    const title = compactText(item.name);
    if (targetTitle.length < 2 || !title.includes(targetTitle)) continue;
    const candidateTokens = artistTokens(`${item.name} ${item.artist}`);
    const artistHit =
      targets.length === 0 || targets.some((token) => candidateTokens.includes(token));
    let score = artistHit ? 100 : 40;
    if (match.durationMs > 0 && item.durationMs > 0) {
      const diff = Math.abs(item.durationMs - match.durationMs);
      if (diff > 60000) continue;
      score += diff <= 10000 ? 30 : 10;
    }
    if (!best || score > best.score) best = { id: item.platformId, score };
  }
  return best?.id ?? null;
};

function parseClock(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return 0;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((number) => !Number.isFinite(number))) return 0;
  return numbers.reduce((acc, part) => acc * 60 + part, 0) * 1000;
}

export { DESKTOP_UA };
