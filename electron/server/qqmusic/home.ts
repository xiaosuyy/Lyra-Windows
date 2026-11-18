import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { safeStorage } from "electron";
import axios from "axios";
import { useStore } from "../../main/store";
import { serverLog } from "../../main/logger";

const MUSICU_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MOBILE_UA = "QQMusic 14090008(android 15)";

/** QQ 音乐登录态 */
export interface QQSession {
  cookie: string;
  uin: string;
  musicKey: string;
  loggedIn: boolean;
  /** musicu 的 tmeLoginType：QQ 账号 2，微信账号 1，App 通道换取时为 6 */
  loginType: number;
}

const cookieValues = (cookie: string): Record<string, string> => {
  const result: Record<string, string> = {};
  cookie
    .split(";")
    .map((item) => item.trim())
    .forEach((entry) => {
      const index = entry.indexOf("=");
      if (index <= 0) return;
      result[entry.slice(0, index).trim()] = entry.slice(index + 1).trim();
    });
  return result;
};

const parseSession = (cookie: string, storedLoginType?: number): QQSession => {
  const values = cookieValues(cookie);
  const rawUin =
    values.qqmusic_uin ||
    (values.login_type === "2" ? values.wxuin : values.uin) ||
    values.wxuin ||
    "";
  const uin = rawUin.trim().replace(/^o/, "").replace(/\D/g, "");
  const musicKey = (values.qm_keyst || values.qqmusic_key || "").trim();
  const loginType = storedLoginType ?? (musicKey.startsWith("W_X") ? 1 : 2);
  return { cookie: cookie.trim(), uin, musicKey, loggedIn: Boolean(uin && musicKey), loginType };
};

/** 读取已保存的 QQ 音乐登录态 */
export const getQQSession = (): QQSession => {
  try {
    const stored = useStore()?.get("qqmusic");
    if (!stored?.cookie) {
      return { cookie: "", uin: "", musicKey: "", loggedIn: false, loginType: 2 };
    }
    let cookie = stored.cookie;
    if (stored.encrypted && safeStorage.isEncryptionAvailable()) {
      try {
        cookie = safeStorage.decryptString(Buffer.from(stored.cookie, "base64"));
      } catch {
        return { cookie: "", uin: "", musicKey: "", loggedIn: false, loginType: 2 };
      }
    }
    return parseSession(
      cookie,
      typeof stored.loginType === "number" ? stored.loginType : undefined,
    );
  } catch {
    return { cookie: "", uin: "", musicKey: "", loggedIn: false, loginType: 2 };
  }
};

/** 保存 QQ 音乐登录态（加密存储） */
export const saveQQSession = (cookie: string, loginType?: number): boolean => {
  const session = parseSession(cookie, loginType);
  if (!session.loggedIn) return false;
  let encrypted = false;
  let stored = cookie;
  if (safeStorage.isEncryptionAvailable()) {
    stored = safeStorage.encryptString(cookie).toString("base64");
    encrypted = true;
  }
  useStore()?.set("qqmusic", { cookie: stored, encrypted, loginType: session.loginType });
  return true;
};

export const clearQQSession = (): void => {
  useStore()?.delete("qqmusic");
};

const hash33 = (value: string, seed = 5381): number => {
  let hash = seed;
  for (const char of value) {
    hash += (hash << 5) + char.charCodeAt(0);
    hash &= 0xffffffff;
  }
  return hash & 0x7fffffff;
};

interface MusicuStyle {
  /** 是否使用移动端 comm（可拿到更完整的榜单） */
  android?: boolean;
}

/** 调用 QQ 音乐 musicu 网关，优先携带登录态 */
const musicu = async (
  module: string,
  method: string,
  param: Record<string, unknown>,
  style: MusicuStyle = {},
  checkRetCode = false,
): Promise<any> => {
  const session = getQQSession();
  const cookie = session.cookie;
  const comm: Record<string, unknown> = style.android
    ? {
        ct: 11,
        cv: "14090008",
        v: "14090008",
        chid: "10003505",
        qq: session.uin || "0",
        authst: session.musicKey,
        tmeAppID: "qqmusic",
        tmeLoginType: session.loginType,
      }
    : {
        ct: 24,
        cv: 4747474,
        format: "json",
        inCharset: "utf-8",
        outCharset: "utf-8",
        notice: 0,
        platform: "yqq.json",
        need_new_code: 1,
        uin: session.uin || "0",
        g_tk: hash33(session.musicKey),
        g_tk_new_20200303: hash33(session.musicKey),
      };
  const payload = {
    comm,
    req_0: { module, method, param },
  };
  const response = await axios.post(MUSICU_URL, payload, {
    timeout: 15000,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": style.android ? MOBILE_UA : DESKTOP_UA,
      Referer: "https://y.qq.com/",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  const data = response.data;
  const req = data?.req_0;
  if (!req || (req.code !== 0 && req.code !== undefined && req.code !== 200)) {
    throw new Error(`QQ音乐接口错误: ${req?.code ?? data?.code ?? "unknown"}`);
  }
  if (checkRetCode) {
    const retCode = Number(req?.data?.retCode ?? req?.data?.retcode ?? 0);
    if (retCode !== 0) throw new Error(`QQ音乐写入返回 ${retCode}`);
  }
  return req.data ?? {};
};

const coverUrl = (albumMid?: string): string =>
  albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : "";

const secureUrl = (value?: string): string => {
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("http://")) return `https://${value.slice(7)}`;
  return value;
};

export interface QQSong {
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

/** 解析 QQ 歌曲结构（兼容 Track 包装层） */
export const parseQQSong = (input: any): QQSong | null => {
  if (!input || typeof input !== "object") return null;
  const raw = input.Track ?? input.track ?? input;
  const mid = raw.mid || raw.songmid;
  const name = raw.name || raw.title || raw.songname;
  if (!mid || !name) return null;
  const singers = Array.isArray(raw.singer)
    ? raw.singer
        .map((item: any) => item?.name)
        .filter(Boolean)
        .join(" / ")
    : raw.singername || "";
  const album = raw.album ?? {};
  const albumMid = album.mid || raw.albummid || "";
  return {
    mid: String(mid),
    songId: String(raw.id || raw.songid || ""),
    name: String(name),
    artist: singers || "未知歌手",
    album: album.name || raw.albumname || "",
    albumMid,
    durationMs: Number(raw.interval || 0) * 1000,
    cover: coverUrl(albumMid),
    mediaMid: raw.file?.media_mid || raw.strMediaMid || albumMid || "",
  };
};

const parseSongs = (list: unknown): QQSong[] => {
  if (!Array.isArray(list)) return [];
  const result: QQSong[] = [];
  for (const item of list) {
    const song = parseQQSong(item);
    if (song) result.push(song);
  }
  return result;
};

const parsePlaylists = (list: unknown): unknown[] => {
  if (!Array.isArray(list)) return [];
  const result: unknown[] = [];
  for (const item of list) {
    const basic = item?.Playlist?.basic ?? item?.basic ?? item;
    const id = Number(basic?.tid || basic?.dissid || item?.dissid || 0);
    const name = String(basic?.title || item?.dissname || "").trim();
    if (!id || !name) continue;
    result.push({
      id,
      name,
      cover: secureUrl(basic?.cover?.medium_url || basic?.cover?.url || item?.imgurl),
      trackCount: Number(basic?.song_cnt || item?.song_count || 0),
      playCount: Number(basic?.play_cnt || item?.listen_num || 0),
    });
  }
  return result;
};

/** 榜单列表 */
const fetchToplists = async (limit = 40): Promise<unknown[]> => {
  let data: any;
  try {
    data = await musicu(
      "music.musicToplist.Toplist",
      "GetAll",
      { offset: 0, num: 60, tag: 0 },
      { android: true },
    );
  } catch (error) {
    serverLog.log(`QQ 榜单 Android 接口失败，回退 Web：${(error as Error).message}`);
    data = await musicu("music.musicToplist.Toplist", "GetAll", { offset: 0, num: 60, tag: 0 });
  }
  const groups = data?.group;
  if (!Array.isArray(groups)) return [];
  const result: unknown[] = [];
  const seen = new Set<number>();
  for (const group of groups) {
    const list = group?.toplist;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const id = Number(item?.topId || 0);
      const name = String(item?.title || "").trim();
      if (!id || !name || name.includes("MV") || name.includes("视频") || seen.has(id)) continue;
      seen.add(id);
      result.push({
        id,
        name,
        cover: secureUrl(item.frontPicUrl || item.headPicUrl),
        trackCount: Number(item.totalNum || 0),
        playCount: Number(item.listenNum || 0),
      });
      if (result.length >= limit) return result;
    }
  }
  return result;
};

/** 推荐信息流卡片（每日 30 首 / 为你精选） */
const fetchRecommendCards = async (): Promise<any[]> => {
  const data = await musicu("music.recommend.RecommendFeed", "get_recommend_feed", {
    direction: 0,
    page: 1,
    v_cache: [],
    v_uniq: [],
    s_num: 0,
    client_time: Math.floor(Date.now() / 1000),
    ext: {
      has_login: "1",
      is_20_style: "1",
      first_req_time: "1",
      client_time_zone: "Asia/Shanghai",
    },
  });
  const shelves = data?.v_shelf;
  if (!Array.isArray(shelves)) return [];
  const cards: any[] = [];
  for (const shelf of shelves) {
    const niches = shelf?.v_niche;
    if (!Array.isArray(niches)) continue;
    for (const niche of niches) {
      const items = niche?.v_card;
      if (Array.isArray(items)) cards.push(...items);
    }
  }
  return cards;
};

const numericId = (value: unknown): number => {
  if (typeof value === "number") return value;
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

/** QQ 歌单歌曲 */
const fetchPlaylistSongs = async (dissId: number, limit: number): Promise<QQSong[]> => {
  const response = await axios.get("https://u.y.qq.com/cgi-bin/musicu.fcg", {
    timeout: 15000,
    params: {
      format: "json",
      data: JSON.stringify({
        comm: { ct: "24", cv: "0" },
        req: {
          module: "music.srfDissInfo.aiDissInfo",
          method: "uniform_get_Dissinfo",
          param: {
            disstid: dissId,
            enc_host_uin: "",
            tag: 1,
            userinfo: 1,
            song_begin: 0,
            song_num: Math.min(Math.max(limit, 1), 200),
          },
        },
      }),
    },
    headers: { "User-Agent": DESKTOP_UA, Referer: "https://y.qq.com/" },
  });
  const songs = response.data?.req?.data?.songlist;
  return parseSongs(songs);
};

/** 单个榜单歌曲 */
const fetchToplistSongs = async (topId: number, limit: number): Promise<QQSong[]> => {
  const data = await musicu("music.musicToplist.Toplist", "GetDetail", {
    topId,
    offset: 0,
    num: Math.min(Math.max(limit, 1), 100),
  });
  return parseSongs(data?.songInfoList);
};

/** 「我喜欢」在 QQ 音乐里的固定目录 id（与手机端一致） */
const QQ_LIKED_DIRECTORY_ID = 201;
/** 单次批量收藏数量（与手机端一致） */
const LIKED_WRITE_BATCH_SIZE = 50;

/** 读取 QQ 音乐「我喜欢」分页（CgiGetDiss + dirid=201，与手机端一致） */
const fetchLikedSongs = async (
  begin: number,
  num: number,
): Promise<{ songs: QQSong[]; total: number }> => {
  const param = {
    dirid: QQ_LIKED_DIRECTORY_ID,
    disstid: 0,
    tag: true,
    song_begin: begin,
    song_num: num,
    userinfo: false,
    orderlist: false,
    onlysonglist: true,
  };
  let data: any;
  try {
    data = await musicu("music.srfDissInfo.DissInfo", "CgiGetDiss", param);
  } catch (error) {
    serverLog.log(`QQ 我喜欢 Web 接口失败，回退 Android：${(error as Error).message}`);
    data = await musicu("music.srfDissInfo.DissInfo", "CgiGetDiss", param, { android: true });
  }
  const songs = parseSongs(data?.songlist);
  const total = Number(data?.total_song_num) || songs.length;
  return { songs, total };
};

const parseJsonText = (value: unknown): any => {
  if (typeof value !== "string") return value ?? {};
  const trimmed = value.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  const text = first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed;
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

interface QQLikedSongRef {
  songId: number;
  songType: number;
}

/** 收藏前解析歌曲写入参数：songId + songType */
const resolveLikedRefs = async (mids: string[]): Promise<Map<string, QQLikedSongRef>> => {
  const session = getQQSession();
  const refs = new Map<string, QQLikedSongRef>();
  try {
    const data = await musicu(
      "music.trackInfo.UniformRuleCtrl",
      "CgiGetTrackInfo",
      {
        ctx: 0,
        client: 1,
        types: mids.map(() => 0),
        modify_stamp: mids.map(() => 0),
        mids,
      },
      { android: true },
    );
    const tracks = data?.tracks || data?.track_list || data?.songlist;
    if (Array.isArray(tracks)) {
      for (const item of tracks) {
        const mid = String(item?.mid ?? item?.songmid ?? "").trim();
        const id = Number(item?.id ?? item?.songid ?? 0);
        if (!mid || !id) continue;
        refs.set(mid, {
          songId: id,
          songType: Number(item?.type ?? item?.songtype ?? 0),
        });
      }
    }
  } catch (error) {
    serverLog.log(`QQ 收藏歌曲信息获取失败：${(error as Error).message}`);
  }
  // 未解析到的逐首回退 Web 详情
  for (const mid of mids) {
    if (refs.has(mid)) continue;
    try {
      const response = await axios.get("https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg", {
        timeout: 15000,
        params: {
          songmid: mid,
          tpl: "yqq_song_detail",
          format: "json",
          g_tk: hash33(session.musicKey),
          loginUin: session.uin,
          hostUin: 0,
          outCharset: "utf8",
          notice: 0,
          platform: "yqq",
          needNewCode: 0,
        },
        headers: {
          "User-Agent": DESKTOP_UA,
          Referer: "https://y.qq.com/",
          ...(session.cookie ? { Cookie: session.cookie } : {}),
        },
      });
      const item = parseJsonText(response.data)?.data?.[0];
      const id = Number(item?.id ?? item?.songid ?? 0);
      if (id > 0) {
        refs.set(mid, { songId: id, songType: Number(item?.type ?? item?.songtype ?? 0) });
      }
    } catch (error) {
      serverLog.log(`QQ 收藏歌曲详情获取失败 ${mid}：${(error as Error).message}`);
    }
  }
  return refs;
};

/** Web 版逐首收藏（部分账号不接受 Android 写接口时回退） */
const legacyAddLikedSong = async (session: QQSession, songMid: string): Promise<void> => {
  const response = await axios.get(
    "https://c.y.qq.com/splcloud/fcgi-bin/fcg_music_add2songdir.fcg",
    {
      timeout: 15000,
      params: {
        g_tk: hash33(session.musicKey),
        midlist: songMid,
        typelist: "13",
        dirid: QQ_LIKED_DIRECTORY_ID,
        addtype: "",
        sender: 4,
        formsender: 4,
        r2: 0,
        r3: 1,
        utf8: 1,
      },
      headers: {
        "User-Agent": DESKTOP_UA,
        Referer: "https://y.qq.com/n/yqq/playlist",
        ...(session.cookie ? { Cookie: session.cookie } : {}),
      },
    },
  );
  const json = parseJsonText(response.data);
  const code = Number(json?.code ?? -1);
  if (code !== 0) throw new Error(json?.msg || `QQ音乐 Web 收藏错误码 ${code}`);
};

/** 批量收藏到 QQ 音乐「我喜欢」 */
const addLikedSongs = async (mids: string[]): Promise<{ added: number; failed: number }> => {
  const session = getQQSession();
  const list = Array.from(new Set(mids.map((mid) => String(mid).trim()).filter(Boolean)));
  let added = 0;
  let failed = 0;
  for (let index = 0; index < list.length; index += LIKED_WRITE_BATCH_SIZE) {
    const chunk = list.slice(index, index + LIKED_WRITE_BATCH_SIZE);
    const refs = await resolveLikedRefs(chunk);
    failed += chunk.filter((mid) => !refs.has(mid)).length;
    if (refs.size === 0) continue;
    try {
      await musicu(
        "music.musicasset.PlaylistDetailWrite",
        "AddSonglist",
        {
          dirId: QQ_LIKED_DIRECTORY_ID,
          tid: 0,
          bFmtUtf8: true,
          v_songInfo: [...refs.values()].map((ref) => ({
            songId: ref.songId,
            songType: ref.songType,
          })),
        },
        { android: true },
        true,
      );
      added += refs.size;
      continue;
    } catch (error) {
      serverLog.log(`QQ 批量收藏失败，回退 Web：${(error as Error).message}`);
    }
    let chunkAdded = 0;
    for (const mid of refs.keys()) {
      try {
        await legacyAddLikedSong(session, mid);
        chunkAdded += 1;
      } catch (error) {
        serverLog.log(`QQ Web 收藏失败 ${mid}：${(error as Error).message}`);
      }
    }
    added += chunkAdded;
    failed += refs.size - chunkAdded;
  }
  return { added, failed };
};

/** 解析播放地址：依次尝试 128k / 320k / 无损 */
const resolveSongUrl = async (mid: string, mediaMid: string): Promise<string | undefined> => {
  const session = getQQSession();
  const candidates = [
    { prefix: "M500", ext: "mp3" },
    { prefix: "M800", ext: "mp3" },
    { prefix: "F000", ext: "flac" },
  ];
  for (const candidate of candidates) {
    try {
      const data = await musicu("music.vkey.GetVkey", "UrlGetVkey", {
        guid: "10000",
        songmid: [mid],
        songtype: [0],
        uin: session.uin || "0",
        loginflag: 1,
        platform: "20",
        filename: [`${candidate.prefix}${mid}${mediaMid || mid}.${candidate.ext}`],
      });
      const purl = data?.midurlinfo?.[0]?.purl;
      if (purl) {
        return purl.startsWith("http") ? purl : `https://ws.stream.qqmusic.qq.com/${purl}`;
      }
    } catch (error) {
      serverLog.log(`QQ 播放地址请求失败(${candidate.prefix})：${(error as Error).message}`);
    }
    if (!session.loggedIn) break;
  }
  return undefined;
};

/** 账号资料 */
export const fetchProfile = async (): Promise<{
  uin: string;
  nickname: string;
  avatarUrl: string;
} | null> => {
  const session = getQQSession();
  if (!session.loggedIn) return null;
  const response = await axios.get(
    "https://c6.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg",
    {
      timeout: 15000,
      params: {
        g_tk: hash33(session.musicKey),
        format: "json",
        inCharset: "utf-8",
        outCharset: "utf-8",
        notice: 0,
        cid: 205360838,
        needNewCode: 0,
        loginUin: session.uin,
        hostUin: 0,
        userid: session.uin,
        reqfrom: 1,
      },
      headers: { "User-Agent": DESKTOP_UA, Referer: "https://y.qq.com/", Cookie: session.cookie },
    },
  );
  const json = response.data;
  if (json?.code !== 0 && json?.code !== undefined) {
    throw new Error(json?.message || json?.msg || "QQ音乐登录状态无效");
  }
  const data = json?.data ?? json;
  const creator = data?.creator ?? data?.user ?? data?.profile ?? {};
  const nickname =
    creator.nick || creator.nickname || creator.name || data.nick || data.nickname || "";
  return {
    uin: session.uin,
    nickname: nickname || `QQ音乐用户 ${session.uin}`,
    avatarUrl: secureUrl(creator.headpic || creator.avatar || creator.avatarUrl),
  };
};

const failure = (reply: FastifyReply, error: unknown) => {
  const message = error instanceof Error ? error.message : "QQ音乐接口请求失败";
  serverLog.error(`❌ QQ 音乐接口失败：${message}`);
  return reply.status(500).send({ code: 500, message });
};

/**
 * 注册 QQ 音乐首页 / 播放地址相关接口
 */
export const registerQQMusicHomeRoutes = (fastify: FastifyInstance): void => {
  fastify.get("/qqmusic/session", async (_req, reply) => {
    const session = getQQSession();
    let profile: { uin: string; nickname: string; avatarUrl: string } | null = null;
    if (session.loggedIn) {
      try {
        profile = await fetchProfile();
      } catch {
        profile = null;
      }
    }
    return reply.send({
      code: 200,
      data: {
        loggedIn: session.loggedIn,
        uin: session.uin,
        nickname: profile?.nickname ?? "",
        avatarUrl: profile?.avatarUrl ?? "",
      },
    });
  });

  fastify.get("/qqmusic/profile", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const profile = await fetchProfile();
      if (!profile) return reply.send({ code: 401, message: "未登录 QQ 音乐" });
      return reply.send({ code: 200, data: profile });
    } catch (error) {
      return failure(reply, error);
    }
  });

  fastify.get(
    "/qqmusic/url",
    async (
      req: FastifyRequest<{ Querystring: { mid?: string; mediaMid?: string } }>,
      reply: FastifyReply,
    ) => {
      const mid = req.query.mid?.trim() ?? "";
      if (!mid) return reply.status(400).send({ code: 400, message: "mid 参数是必须的" });
      try {
        const url = await resolveSongUrl(mid, req.query.mediaMid?.trim() ?? "");
        if (!url) return reply.send({ code: 404, message: "暂无可用播放地址" });
        return reply.send({ code: 200, data: { url } });
      } catch (error) {
        return failure(reply, error);
      }
    },
  );

  fastify.get(
    "/qqmusic/home",
    async (
      req: FastifyRequest<{
        Querystring: { section?: string; limit?: string; mode?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const section = req.query.section ?? "all";
      const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 60);
      const radarMode = Math.min(Math.max(Number(req.query.mode) || 2, 1), 3);
      try {
        const data: Record<string, unknown> = {};
        if (section === "all" || section === "radar") {
          const radar = await musicu("music.recommend.TrackRelationServer", "GetRadarSong", {
            Page: 1,
            Mode: radarMode,
          });
          data.radar = parseSongs(radar?.VecSongs).slice(0, limit + 18);
        }
        if (section === "all" || section === "roam") {
          const roam = await musicu("music.radioProxy.MbTrackRadioSvr", "get_radio_track", {
            PageSize: 20,
          });
          data.roam = parseSongs(roam?.tracks);
        }
        if (section === "all" || section === "new") {
          const fresh = await musicu("newsong.NewSongServer", "get_new_song_info", { type: 1 });
          data.newSongs = parseSongs(fresh?.songlist).slice(0, limit);
        }
        if (section === "all" || section === "playlists") {
          const squares = await musicu("music.playlist.PlaylistSquare", "GetRecommendFeed", {
            From: 0,
            Size: Math.min(limit + 4, 30),
          });
          data.playlists = parsePlaylists(squares?.List).slice(0, limit);
        }
        if (section === "all" || section === "daily") {
          const session = getQQSession();
          data.daily = [];
          if (session.loggedIn) {
            try {
              const cards = await fetchRecommendCards();
              const dailyCard = cards.find(
                (card) =>
                  Number(card?.subtype) === 510 || String(card?.title ?? "").includes("每日"),
              );
              const id = numericId(dailyCard?.id);
              if (id) data.daily = await fetchPlaylistSongs(id, 30);
            } catch (error) {
              serverLog.log(`QQ 每日推荐获取失败：${(error as Error).message}`);
            }
          }
        }
        if (section === "all" || section === "hot") {
          data.hot = (await fetchToplistSongs(26, 30)) ?? [];
        }
        if (section === "all" || section === "toplists") {
          data.toplists = await fetchToplists(24);
        }
        return reply.send({ code: 200, data });
      } catch (error) {
        return failure(reply, error);
      }
    },
  );

  fastify.get(
    "/qqmusic/playlist",
    async (
      req: FastifyRequest<{ Querystring: { id?: string; limit?: string } }>,
      reply: FastifyReply,
    ) => {
      const id = Number(req.query.id);
      if (!id) return reply.status(400).send({ code: 400, message: "id 参数是必须的" });
      try {
        const songs = await fetchPlaylistSongs(id, Number(req.query.limit) || 100);
        return reply.send({ code: 200, data: { songs } });
      } catch (error) {
        return failure(reply, error);
      }
    },
  );

  fastify.get(
    "/qqmusic/toplist",
    async (
      req: FastifyRequest<{ Querystring: { id?: string; limit?: string } }>,
      reply: FastifyReply,
    ) => {
      const id = Number(req.query.id);
      if (!id) return reply.status(400).send({ code: 400, message: "id 参数是必须的" });
      try {
        const songs = await fetchToplistSongs(id, Number(req.query.limit) || 60);
        return reply.send({ code: 200, data: { songs } });
      } catch (error) {
        return failure(reply, error);
      }
    },
  );

  // QQ 音乐「我喜欢」分页，供收藏页导入使用
  fastify.get(
    "/qqmusic/liked",
    async (
      req: FastifyRequest<{ Querystring: { begin?: string; num?: string } }>,
      reply: FastifyReply,
    ) => {
      const session = getQQSession();
      if (!session.loggedIn) {
        return reply.status(401).send({ code: 401, message: "未登录 QQ 音乐" });
      }
      const begin = Math.max(0, Number(req.query.begin) || 0);
      const num = Math.min(Math.max(Number(req.query.num) || 200, 1), 300);
      try {
        return reply.send({ code: 200, data: await fetchLikedSongs(begin, num) });
      } catch (error) {
        return failure(reply, error);
      }
    },
  );

  // 批量同步本地收藏到 QQ 音乐「我喜欢」
  fastify.post(
    "/qqmusic/liked",
    async (req: FastifyRequest<{ Body: { mids?: unknown } }>, reply: FastifyReply) => {
      const session = getQQSession();
      if (!session.loggedIn) {
        return reply.status(401).send({ code: 401, message: "未登录 QQ 音乐" });
      }
      const mids = Array.isArray(req.body?.mids)
        ? req.body.mids.filter((mid): mid is string => typeof mid === "string")
        : [];
      if (mids.length === 0) {
        return reply.send({ code: 200, data: { added: 0, failed: 0 } });
      }
      try {
        return reply.send({ code: 200, data: await addLikedSongs(mids) });
      } catch (error) {
        return failure(reply, error);
      }
    },
  );
};
