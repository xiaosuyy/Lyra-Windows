import { personalFm, personalFmToTrash } from "@/api/rec";
import { songQuality, songUrl, unlockSongUrl } from "@/api/song";
import { qqMusicUrl } from "@/api/qqmusic";
import { useLyricManager } from "@/core/player/LyricManager";
import {
  useDataStore,
  useMusicStore,
  useSettingStore,
  useStatusStore,
  useStreamingStore,
} from "@/stores";
import { QualityType, type SongType, type AudioSourceType } from "@/types/main";
import { isLogin } from "@/utils/auth";
import { isElectron } from "@/utils/env";
import { formatSongsList } from "@/utils/format";
import { toFileUrl } from "@/utils/fileUrl";
import { AI_AUDIO_LEVELS } from "@/utils/meta";
import { handleSongQuality } from "@/utils/helper";
import { openUserLogin } from "@/utils/modal";

/**
 * 歌曲解锁服务器
 */
export enum SongUnlockServer {
  NETEASE = "netease",
  TENCENT = "tencent",
  KUGOU = "kugou",
  KUWO = "kuwo",
  MIGU = "migu",
  BILIBILI = "bilibili",
}

/** 歌曲播放地址信息 */
export type AudioSource = {
  /** 歌曲id */
  id: number;
  /** 歌曲播放地址 */
  url?: string;
  /** 是否解锁 */
  isUnlocked?: boolean;
  /** 是否为试听 */
  isTrial?: boolean;
  /** 音质 */
  quality?: QualityType;
  /** 音源 */
  source?: AudioSourceType;
};

/**
 * 歌曲管理器
 * 负责歌曲的获取、缓存、预加载等操作
 */
class SongManager {
  /** 预载下一首歌曲播放信息 */
  private nextPrefetch: AudioSource | undefined;
  /** 播放失败的地址（短时拉黑，避免反复取到坏链） */
  private failedUrls = new Map<string, number>();
  private readonly FAILED_URL_TTL = 5 * 60 * 1000;

  /** 标记播放失败的地址，下次取流自动跳过 */
  public markSourceFailed(url?: string | null) {
    if (!url || !/^https?:/i.test(url)) return;
    this.failedUrls.set(url, Date.now());
    if (this.failedUrls.size > 300) {
      const now = Date.now();
      for (const [key, at] of this.failedUrls) {
        if (now - at > this.FAILED_URL_TTL) this.failedUrls.delete(key);
      }
    }
  }

  private isSourceFailed(url?: string | null): boolean {
    if (!url) return true;
    const at = this.failedUrls.get(url);
    if (!at) return false;
    if (Date.now() - at > this.FAILED_URL_TTL) {
      this.failedUrls.delete(url);
      return false;
    }
    return true;
  }

  public peekPrefetch(id: number): AudioSource | undefined {
    if (!this.nextPrefetch) return;
    if (this.nextPrefetch.id !== id) return;
    return this.nextPrefetch;
  }

  public async getMusicCachePath(
    id: number | string,
    quality?: QualityType | string,
  ): Promise<string | null> {
    const settingStore = useSettingStore();
    if (!isElectron || !settingStore.cacheEnabled || !settingStore.songCacheEnabled) return null;
    try {
      return await window.electron.ipcRenderer.invoke("music-cache-check", id, quality);
    } catch {
      return null;
    }
  }

  public async ensureMusicCachePath(
    id: number | string,
    url: string | undefined,
    quality?: QualityType | string,
  ): Promise<string | null> {
    const existing = await this.getMusicCachePath(id, quality);
    if (existing) return existing;
    if (!url) return null;

    const settingStore = useSettingStore();
    if (!isElectron || !settingStore.cacheEnabled || !settingStore.songCacheEnabled) return null;
    try {
      const result: unknown = await window.electron.ipcRenderer.invoke(
        "music-cache-download",
        id,
        url,
        quality || "standard",
      );
      if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.success === true && typeof record.path === "string") {
          return record.path;
        }
      }
    } catch {
      return null;
    }
    return await this.getMusicCachePath(id);
  }

  /**
   * 预加载封面图片
   * @param song 歌曲信息
   */
  private prefetchCover(song: SongType): void {
    if (!song || song.path) return; // 本地歌曲跳过

    const coverUrls: string[] = [];

    // 收集需要预加载的封面 URL
    if (song.coverSize) {
      // 优先预加载大尺寸封面
      if (song.coverSize.xl) coverUrls.push(song.coverSize.xl);
      if (song.coverSize.l) coverUrls.push(song.coverSize.l);
    }
    if (song.cover && !coverUrls.includes(song.cover)) {
      coverUrls.push(song.cover);
    }
    // 预加载图片
    coverUrls.forEach((url) => {
      if (!url || !url.startsWith("http")) return;
      const img = new Image();
      // 清理
      const cleanup = () => {
        img.onload = null;
        img.onerror = null;
      };
      img.onload = cleanup;
      img.onerror = cleanup;
      img.src = url;
    });
  }

  /**
   * 检查本地缓存
   * @param id 歌曲id
   * @param quality 音质
   * @param md5 歌曲文件md5
   */
  private checkLocalCache = async (
    id: number,
    quality?: QualityType,
    md5?: string,
  ): Promise<string | null> => {
    const settingStore = useSettingStore();
    if (isElectron && settingStore.cacheEnabled && settingStore.songCacheEnabled) {
      try {
        const cachePath = await window.electron.ipcRenderer.invoke(
          "music-cache-check",
          id,
          quality,
          md5,
        );
        if (cachePath) {
          console.log(`🚀 [${id}] 由本地音乐缓存提供`);
          return toFileUrl(cachePath);
        }
      } catch (e) {
        console.error(`❌ [${id}] 检查缓存失败:`, e);
      }
    }
    return null;
  };

  /**
   * 触发缓存下载
   * @param id 歌曲id
   * @param url 下载地址
   * @param quality 音质
   */
  private triggerCacheDownload = (id: number, url: string, quality?: QualityType | string) => {
    const settingStore = useSettingStore();
    if (isElectron && settingStore.cacheEnabled && settingStore.songCacheEnabled && url) {
      window.electron.ipcRenderer.invoke("music-cache-download", id, url, quality || "standard");
    }
  };

  /** 音质降级顺序 */
  private buildLevelChain(level: string): string[] {
    const order = ["jymaster", "hires", "lossless", "exhigh", "higher", "standard"];
    if (level === "dolby") return ["dolby", "hires", "lossless", "exhigh", "standard"];
    if (level === "jyeffect" || level === "sky") {
      return [level, "hires", "lossless", "exhigh", "standard"];
    }
    const index = order.indexOf(level);
    return order.slice(index >= 0 ? index : order.indexOf("exhigh"));
  }

  /**
   * 获取在线播放链接（按音质逐级降级，并跳过已失败地址）
   * @param id 歌曲id
   * @param isPc 是否使用较高音质
   * @returns 在线播放信息
   */
  public getOnlineUrl = async (id: number, isPc: boolean = false): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    let level: string = isPc ? "exhigh" : settingStore.songLevel;

    // Fuck AI Mode: 如果开启，且请求的 level 是 AI 音质，降级为 hires
    if (settingStore.disableAiAudio && AI_AUDIO_LEVELS.includes(level)) {
      level = "hires";
    }

    // 如果请求杜比音质，先检查歌曲是否支持
    if (level === "dolby") {
      try {
        const qualityRes = await songQuality(id);
        const hasDb = qualityRes.data?.db && Number(qualityRes.data.db.br) > 0;
        // 如果不支持杜比，降级到最高可用音质
        if (!hasDb) {
          console.log(`🔽 [${id}] 歌曲不支持杜比音质，自动降级`);
          if (qualityRes.data?.hr && Number(qualityRes.data.hr.br) > 0) {
            level = "hires";
          } else if (qualityRes.data?.sq && Number(qualityRes.data.sq.br) > 0) {
            level = "lossless";
          } else {
            level = "exhigh";
          }
        }
      } catch (e) {
        console.error(`检查杜比音质支持失败，降级到极高音质:`, e);
        level = "exhigh";
      }
    }

    const levels = this.buildLevelChain(level);
    let trialCandidate: AudioSource | undefined;

    for (const currentLevel of levels) {
      let res: any;
      try {
        res = await songUrl(id, currentLevel as any);
      } catch (error) {
        console.warn(`⚠️ [${id}] ${currentLevel} 音质请求失败，尝试降级`, error);
        continue;
      }
      // 兼容新旧接口的数据结构
      const songData = Array.isArray(res?.data) ? res.data[0] : res?.data?.[0];
      if (!songData?.url || this.isSourceFailed(songData.url)) continue;

      const isTrial = songData?.freeTrialInfo != null;
      const normalizedUrl = isElectron
        ? songData.url
        : songData.url
            .replace(/^http:/, "https:")
            .replace(/m804\.music\.126\.net/g, "m801.music.126.net")
            .replace(/m704\.music\.126\.net/g, "m701.music.126.net");
      const quality =
        currentLevel === "dolby" ? QualityType.Dolby : handleSongQuality(songData, "online");

      if (isTrial) {
        trialCandidate ??= {
          id,
          url: settingStore.playSongDemo ? normalizedUrl : undefined,
          isTrial,
          quality,
        };
        console.log(`🔒 [${id}] ${currentLevel} 仅可试听，尝试下一音质`);
        continue;
      }

      // 检查本地缓存
      const cachedUrl = await this.checkLocalCache(id, quality, songData?.md5);
      if (cachedUrl) {
        return { id, url: cachedUrl, isTrial, quality };
      }
      this.triggerCacheDownload(id, normalizedUrl, quality);
      return { id, url: normalizedUrl, isTrial, quality };
    }

    return trialCandidate ?? { id, url: undefined };
  };

  /** 是否为可直接播放的音频地址 */
  private isPlayableUrl(url?: string | null): boolean {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    if (/kugou\.com\/song|music\.163\.com\/song|y\.qq\.com\/n\/ryqq/i.test(url)) return false;
    return true;
  }

  /**
   * 获取解锁播放链接（按设置顺序逐个尝试，超时或失败自动换源）
   * @param songData 歌曲数据
   * @param specificSource 指定解锁源
   * @returns
   */
  public getUnlockSongUrl = async (
    song: SongType,
    specificSource?: string,
  ): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const songId = song.id;
    // 优先检查本地缓存 (仅在未指定源或指定为 auto 时)
    if (!specificSource || specificSource === "auto") {
      const cachedUrl = await this.checkLocalCache(songId);
      if (cachedUrl) {
        // Auto 模式下命中缓存，尝试获取第一个启用的源作为标识
        let source: AudioSourceType = SongUnlockServer.NETEASE;
        const firstEnabled = settingStore.songUnlockServer.find((s) => s.enabled);
        if (firstEnabled) source = firstEnabled.key as AudioSourceType;
        return {
          id: songId,
          url: cachedUrl,
          isUnlocked: true,
          source,
          quality: QualityType.HQ,
        };
      }
    }
    const artistName = Array.isArray(song.artists)
      ? song.artists.map((a) => a.name).join(" & ")
      : song.artists;
    const keyWord = song.name + "-" + artistName;
    if (!songId || !keyWord) {
      return { id: songId, url: undefined };
    }

    // 获取音源列表
    let servers: SongUnlockServer[] = [];
    if (specificSource && specificSource !== "auto") {
      servers = [specificSource as SongUnlockServer];
    } else {
      servers = settingStore.songUnlockServer
        .filter((s) => s.enabled)
        .map((s) => s.key as SongUnlockServer);
    }
    if (servers.length === 0) {
      return { id: songId, url: undefined };
    }

    // QQ 歌曲的 id 不是网易云 id，交给服务端按歌名检索
    const neteaseId = song.qqMid ? 0 : songId;
    const timeoutMs = specificSource && specificSource !== "auto" ? 15000 : 8000;
    const timeout = <T>(task: Promise<T>): Promise<T | null> =>
      Promise.race([
        task.catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);

    // 并发请求，但按设置顺序选择第一个可用音源，整体等待时间受限
    const results = await Promise.all(
      servers.map(async (server) => ({
        server,
        result: await timeout(
          unlockSongUrl(
            neteaseId,
            keyWord,
            server,
            song.name,
            String(artistName || ""),
            song.duration,
          ),
        ),
      })),
    );

    for (const { server, result } of results) {
      const unlockUrl = result?.url;
      if (result?.code !== 200 || !this.isPlayableUrl(unlockUrl)) continue;
      if (this.isSourceFailed(unlockUrl)) {
        console.log(`🚫 [${songId}] ${server} 返回已失败地址，尝试下一个音源`);
        continue;
      }
      // 解锁成功后，触发下载
      this.triggerCacheDownload(songId, unlockUrl);
      // 推断音质
      let quality = QualityType.HQ;
      if (unlockUrl && (unlockUrl.includes(".flac") || unlockUrl.includes(".wav"))) {
        quality = QualityType.SQ;
      }
      console.log(`🔓 [${songId}] ${server} 解锁成功`, { unlockUrl, quality });
      return {
        id: songId,
        url: unlockUrl,
        isUnlocked: true,
        quality,
        source: server,
      };
    }
    return { id: songId, url: undefined };
  };

  /**
   * 获取 QQ 音乐播放地址
   * @param song 歌曲
   * @returns 音频源
   */
  private getQQMusicSource = async (song: SongType): Promise<AudioSource> => {
    if (!song.qqMid) return { id: song.id, url: undefined };
    try {
      const result = await qqMusicUrl(song.qqMid, song.qqMediaMid);
      const url: string | undefined = result?.data?.url;
      if (result?.code === 200 && url && !this.isSourceFailed(url)) {
        return {
          id: song.id,
          url,
          quality: /\.(flac|wav|ape)$/i.test(url) ? QualityType.SQ : QualityType.HQ,
          isUnlocked: false,
          source: "tencent",
        };
      }
    } catch (error) {
      console.error(`❌ [${song.qqMid}] 获取 QQ 音乐播放地址失败:`, error);
    }
    return { id: song.id, url: undefined, isUnlocked: false };
  };

  /**
   * 统一在线取流（官方 -> 解锁音源 -> 本地缓存）
   * @param song 歌曲
   * @param forceSource 指定音源
   * @param silent 静默模式（预加载时不弹提示）
   */
  private resolveOnlineSource = async (
    song: SongType,
    forceSource?: string,
    silent: boolean = false,
  ): Promise<AudioSource> => {
    const settingStore = useSettingStore();
    const songId = song.type === "radio" ? song.dj?.id : song.id;
    if (!songId) return { id: 0, url: undefined, quality: undefined, isUnlocked: false };
    const canUnlock = isElectron && song.type !== "radio" && settingStore.useSongUnlock;

    // 指定音源
    if (forceSource && forceSource !== "auto") {
      if (forceSource === "official") {
        return song.qqMid ? this.getQQMusicSource(song) : this.getOnlineUrl(songId, !!song.pc);
      }
      if (!canUnlock) return { id: songId, url: undefined };
      const unlocked = await this.getUnlockSongUrl(song, forceSource);
      return unlocked.url ? unlocked : { id: songId, url: undefined };
    }

    // QQ 歌曲：QQ 官方 -> Lyra 音源 -> 本地缓存
    if (song.qqMid) {
      const qqSource = await this.getQQMusicSource(song);
      if (qqSource.url) return qqSource;
      if (canUnlock) {
        const unlocked = await this.getUnlockSongUrl(song);
        if (unlocked.url) return unlocked;
      }
      const cachedUrl = await this.checkLocalCache(songId);
      if (cachedUrl) {
        return {
          id: songId,
          url: cachedUrl,
          isUnlocked: true,
          source: "local",
          quality: QualityType.HQ,
        };
      }
      return { id: songId, url: undefined, quality: undefined, isUnlocked: false };
    }

    // 网易云 / 电台：官方 -> 解锁音源 -> 本地缓存
    const official = await this.getOnlineUrl(songId, !!song.pc);
    if (official.url && (!official.isTrial || settingStore.playSongDemo)) {
      if (official.isTrial && !silent) window.$message.warning("当前歌曲仅可试听");
      return { ...official, isUnlocked: false, source: "official" };
    }
    if (canUnlock) {
      const unlocked = await this.getUnlockSongUrl(song);
      if (unlocked.url) return unlocked;
    }
    const cachedUrl = await this.checkLocalCache(songId);
    if (cachedUrl) {
      return {
        id: songId,
        url: cachedUrl,
        isUnlocked: true,
        source: "local",
        quality: QualityType.HQ,
      };
    }
    return { id: songId, url: undefined, quality: undefined, isUnlocked: false };
  };

  /**
   * 预载下一首歌曲
   * @returns 预载数据
   */
  public prefetchNextSong = async (): Promise<AudioSource | undefined> => {
    try {
      const dataStore = useDataStore();
      const statusStore = useStatusStore();
      const settingStore = useSettingStore();
      const lyricManager = useLyricManager();
      const musicStore = useMusicStore();
      // 私人FM模式：预载FM列表中的下一首
      if (statusStore.personalFmMode) {
        const fmList = musicStore.personalFM.list;
        const fmIndex = musicStore.personalFM.playIndex;
        // 当前批次已是最后一首，提前拉取下一批追加到列表
        if (fmIndex >= fmList.length - 1) {
          try {
            const res = await personalFm();
            const newList = formatSongsList(res.data);
            if (newList?.length) {
              musicStore.personalFM.list = [...fmList, ...newList];
            }
          } catch (e) {
            console.warn("⚠️ 预拉取下一批私人FM失败", e);
            return;
          }
        }
        const nextSong = musicStore.personalFM.list[fmIndex + 1];
        if (!nextSong?.id) return;
        this.prefetchCover(nextSong);
        lyricManager.prefetchLyric(nextSong);
        const source = await this.resolveOnlineSource(nextSong, undefined, true);
        if (source.url) {
          this.nextPrefetch = source;
          return this.nextPrefetch;
        }
        return;
      }
      // 无播放列表直接跳过
      const playList = dataStore.playList;
      if (!playList?.length) {
        return;
      }
      // 计算下一首（循环到首）
      let nextIndex = statusStore.playIndex + 1;
      if (nextIndex >= playList.length) nextIndex = 0;
      const nextSong = playList[nextIndex];
      if (!nextSong) return;
      // 预加载封面图片
      this.prefetchCover(nextSong);
      // 预加载歌词
      lyricManager.prefetchLyric(nextSong);
      // 本地歌曲
      if (nextSong.path) {
        // 预分析音频 (Automix)
        if (isElectron && settingStore.enableAutomix) {
          window.electron.ipcRenderer.invoke("analyze-audio-head", nextSong.path).catch((e) => {
            console.warn("[Prefetch] Analysis failed:", e);
          });
        }
        return;
      }
      // 流媒体歌曲
      if (nextSong.type === "streaming" && nextSong.streamUrl) {
        this.nextPrefetch = {
          id: nextSong.id,
          url: nextSong.streamUrl,
          isUnlocked: false,
          quality: QualityType.SQ,
        };
        return this.nextPrefetch;
      }

      // 在线歌曲：官方 -> 解锁音源 -> 本地缓存（统一兜底）
      const source = await this.resolveOnlineSource(nextSong, undefined, true);
      if (source.url) {
        this.nextPrefetch = source;
        return this.nextPrefetch;
      }
      return;
    } catch (error) {
      console.error("❌ 预加载下一首歌曲地址失败", error);
      return;
    }
  };

  /**
   * 清除预加载缓存
   */
  public clearPrefetch() {
    this.nextPrefetch = undefined;
    console.log("🧹 已清除歌曲 URL 缓存");
  }

  /**
   * 获取音频源
   * 始终从此方法获取对应歌曲播放信息
   * @param song 歌曲
   * @returns 音频源
   */
  public getAudioSource = async (song: SongType, forceSource?: string): Promise<AudioSource> => {
    const settingStore = useSettingStore();

    // 本地文件直接返回
    if (song.path && song.type !== "streaming") {
      // 检查本地文件是否存在
      const result = await window.electron.ipcRenderer.invoke("file-exists", song.path);
      if (!result) {
        this.nextPrefetch = undefined;
        console.error("❌ 本地文件不存在");
        return { id: song.id, url: undefined };
      }
      const fileUrl = toFileUrl(song.path);
      return { id: song.id, url: fileUrl, source: "local" };
    }

    // Stream songs (Subsonic / Jellyfin)
    if (song.type === "streaming" && song.streamUrl) {
      const streamingStore = useStreamingStore();
      const finalUrl = streamingStore.getSongUrl(song);
      console.log(`🔄 [${song.id}] Stream URL:`, finalUrl);
      return {
        id: song.id,
        url: finalUrl,
        isUnlocked: false,
        quality: song.quality || QualityType.SQ,
        source: "streaming",
      };
    }

    // 在线歌曲
    const songId = song.type === "radio" ? song.dj?.id : song.id;
    if (!songId) return { id: 0, url: undefined, quality: undefined, isUnlocked: false };

    // 检查缓存并返回
    if (
      !forceSource &&
      this.nextPrefetch &&
      this.nextPrefetch.id === songId &&
      settingStore.useNextPrefetch &&
      !this.isSourceFailed(this.nextPrefetch.url)
    ) {
      console.log(`🚀 [${songId}] 使用预加载缓存播放`);
      const cachedSource = this.nextPrefetch;
      this.nextPrefetch = undefined;
      return cachedSource;
    }

    // 在线获取：官方 -> 解锁音源 -> 本地缓存
    try {
      return await this.resolveOnlineSource(song, forceSource);
    } catch (e) {
      console.error(`❌ [${songId}] 获取音频源异常:`, e);
      // 异常时的兜底：检查本地是否有缓存
      if (!forceSource || forceSource === "auto") {
        const fallbackUrl = await this.checkLocalCache(songId);
        if (fallbackUrl) {
          console.log(`🚀 [${songId}] 获取异常，使用本地缓存兜底`);
          return {
            id: songId,
            url: fallbackUrl,
            isUnlocked: true,
            source: "local",
            quality: QualityType.HQ,
          };
        }
      }
      return {
        id: songId,
        url: undefined,
        quality: undefined,
        isUnlocked: false,
      };
    }
  };

  /**
   * 初始化/播放私人 FM
   * @param playNext 是否播放下一首
   * @returns 是否成功
   */
  public async initPersonalFM(playNext: boolean = false) {
    const musicStore = useMusicStore();
    const statusStore = useStatusStore();

    try {
      const fetchFM = async () => {
        const res = await personalFm();
        musicStore.personalFM.list = formatSongsList(res.data);
        musicStore.personalFM.playIndex = 0;
      };

      // 若列表为空或已播放到最后，获取新列表
      if (musicStore.personalFM.list.length === 0) await fetchFM();
      // 如果需要播放下一首
      if (playNext) {
        statusStore.personalFmMode = true;
        // 如果当前列表还没播完
        if (musicStore.personalFM.playIndex < musicStore.personalFM.list.length - 1) {
          musicStore.personalFM.playIndex++;
        } else {
          // 列表播完了，获取新的
          await fetchFM();
        }
      }
    } catch (error) {
      console.error("❌ 私人 FM 初始化失败", error);
    }
  }

  /**
   * 私人 FM 垃圾桶
   */
  public async personalFMTrash(id: number, onSuccess?: () => void) {
    if (!isLogin()) {
      openUserLogin(true);
      return;
    }
    const statusStore = useStatusStore();
    statusStore.personalFmMode = true;
    try {
      await personalFmToTrash(id);
      window.$message.success("已移至垃圾桶");
      onSuccess?.();
    } catch (error) {
      window.$message.error("移至垃圾桶失败，请重试");
      console.error("❌ 私人 FM 垃圾桶失败", error);
    }
  }

  /**
   * 刷新私人 FM
   */
  public async refreshPersonalFM() {
    const musicStore = useMusicStore();
    if (!isLogin()) {
      window.$message.error("请先登录");
      return;
    }
    try {
      const res = await personalFm();
      const newList = formatSongsList(res.data);
      if (!newList || newList.length === 0) {
        throw new Error("加载私人漫游列表失败");
      }
      musicStore.personalFM.list = newList;
      musicStore.personalFM.playIndex = 0;
      window.$message.success("刷新成功");
    } catch (error) {
      console.error("❌ 刷新私人 FM 失败", error);
      window.$message.error("刷新失败，请重试");
    }
  }
}

let instance: SongManager | null = null;

/**
 * 获取 SongManager 实例
 * @returns SongManager
 */
export const useSongManager = (): SongManager => {
  if (!instance) instance = new SongManager();
  return instance;
};
