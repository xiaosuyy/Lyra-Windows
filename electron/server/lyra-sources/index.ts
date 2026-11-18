import { lxSourceManager, type LyraSource } from "./lx";
import {
  pickBest,
  pickBilibiliCandidate,
  searchKugou,
  searchKuwo,
  searchMigu,
  searchNetease,
  searchTencent,
  type MatchInfo,
  type PlatformSong,
} from "./platform";
import { biliResolveUrl, biliSearch } from "./bilibili";
import { serverLog } from "../../main/logger";

/** 解锁查询参数 */
export interface LyraUnlockQuery {
  songName: string;
  artist: string;
  durationMs: number;
  /** 网易云歌曲 id */
  neteaseId?: string;
  /** 本地服务地址，用于 B 站音频代理 */
  proxyBase?: string;
}

/** 解锁结果 */
export interface LyraUnlockResult {
  code: number;
  url: string | null;
}

const notFound: LyraUnlockResult = { code: 404, url: null };
const SOURCE_TIMEOUT = 15000;

/** 单音源整体超时，避免某个脚本长期卡住播放 */
const withTimeout = <T>(task: Promise<T>, timeoutMs = SOURCE_TIMEOUT): Promise<T | null> =>
  Promise.race([
    task.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);

/** 网易云直链兜底（GD 音乐台） */
const neteaseGdUrl = async (id: string): Promise<string | null> => {
  try {
    const response = await fetch(
      `https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=${encodeURIComponent(id)}`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { url?: string };
    return typeof data?.url === "string" && data.url.startsWith("http") ? data.url : null;
  } catch {
    return null;
  }
};

const searchSource = async (source: LyraSource, keyword: string): Promise<PlatformSong[]> => {
  switch (source) {
    case "tencent":
      return searchTencent(keyword);
    case "kugou":
      return searchKugou(keyword);
    case "kuwo":
      return searchKuwo(keyword);
    case "migu":
      return searchMigu(keyword);
    default:
      return [];
  }
};

/**
 * 按 Lyra 手机端音源解析播放地址
 */
export const resolveLyraSongUrl = async (
  source: LyraSource,
  query: LyraUnlockQuery,
): Promise<LyraUnlockResult> => {
  const songName = query.songName.trim();
  const artist = query.artist.trim();
  if (!songName) return notFound;

  const match: MatchInfo = { songName, artist, durationMs: query.durationMs };

  try {
    // 网易云：优先歌曲 id，无 id 时按歌名搜索
    if (source === "netease") {
      let neteaseId = query.neteaseId;
      if (!neteaseId) {
        const withArtist = await searchNetease(`${songName} ${artist}`.trim());
        const best = pickBest(match, withArtist) ?? pickBest(match, await searchNetease(songName));
        if (best) neteaseId = best.platformId;
      }
      if (!neteaseId) return notFound;
      const result = await withTimeout(
        lxSourceManager.resolve(source, {
          platformId: neteaseId,
          hash: neteaseId,
          name: songName,
          artist,
          durationMs: query.durationMs,
        }),
      );
      if (result?.url) return { code: 200, url: result.url };
      const fallback = await withTimeout(neteaseGdUrl(neteaseId), 8000);
      if (fallback) return { code: 200, url: fallback };
      return notFound;
    }

    const keyword = `${songName} ${artist}`.trim();

    // B 站：搜索视频后经本地代理播放
    if (source === "bilibili") {
      const list = await withTimeout(biliSearch(keyword));
      const bvid = pickBilibiliCandidate(match, list ?? []);
      if (!bvid) return notFound;
      const resolved = await withTimeout(biliResolveUrl(bvid), 12000);
      if (!resolved) return notFound;
      if (query.proxyBase) {
        return {
          code: 200,
          url: `${query.proxyBase}/api/unblock/bili/play?bvid=${encodeURIComponent(bvid)}`,
        };
      }
      return { code: 200, url: resolved.url };
    }

    // 其他平台：搜索同名歌曲并交给 LX 脚本取链；带歌手无结果时退回纯歌名
    let best = pickBest(match, await searchSource(source, keyword));
    if (!best) best = pickBest(match, await searchSource(source, songName));
    if (!best) {
      serverLog.info(`🔎 ${source} 未找到匹配歌曲：${keyword}`);
      return notFound;
    }
    const result = await withTimeout(lxSourceManager.resolve(source, best));
    if (!result?.url) return notFound;
    return { code: 200, url: result.url };
  } catch (error) {
    serverLog.warn(`⚠️ ${source} 解锁失败：${(error as Error).message}`);
    return notFound;
  }
};
