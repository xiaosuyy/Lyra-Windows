import request from "@/utils/request";

/**
 * QQ 音乐模糊匹配歌词响应
 */
export interface QQMusicMatchResponse {
  code: number;
  song?: {
    id: string;
    mid: string;
    name: string;
    artist: string;
    album: string;
    duration: number;
  };
  /** LRC 格式歌词 */
  lrc?: string;
  /** QRC 逐字歌词原始内容 */
  qrc?: string;
  /** 翻译歌词 */
  trans?: string;
  /** 罗马音歌词 */
  roma?: string;
  message?: string;
}

/**
 * QQ 音乐模糊匹配获取歌词
 * @param keyword 搜索关键词（建议格式：歌曲名-歌手名）
 * @returns 歌词数据
 */
export const qqMusicMatch = (keyword: string): Promise<QQMusicMatchResponse> => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/match",
    params: { keyword },
  });
};

/**
 * QQ 音乐搜索歌曲
 * @param keyword 搜索关键词
 * @param page 页码
 * @param pageSize 每页数量
 */
export const qqMusicSearch = (keyword: string, page = 1, pageSize = 20) => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/search",
    params: { keyword, page, pageSize },
  });
};

/**
 * QQ 音乐获取歌词
 * @param id 歌曲 ID（数字）
 * @param name 歌曲名称
 * @param artist 歌手名称
 */
export const qqMusicLyric = (id: number, name?: string, artist?: string) => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/lyric",
    params: { id, name, artist },
  });
};

/** QQ 音乐首页数据；mode 为雷达模式（1 熟悉 / 2 默认 / 3 探索） */
export const qqMusicHome = (section = "all", limit = 12, mode = 2) => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/home",
    params: { section, limit, mode },
  });
};

/** QQ 音乐歌单歌曲 */
export const qqMusicPlaylist = (id: number, limit = 100) => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/playlist",
    params: { id, limit },
  });
};

/** QQ 音乐排行榜歌曲 */
export const qqMusicToplist = (id: number, limit = 60) => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/toplist",
    params: { id, limit },
  });
};

/** QQ 音乐播放地址 */
export const qqMusicUrl = (mid: string, mediaMid?: string) => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/url",
    params: { mid, mediaMid },
  });
};

/** QQ 音乐登录状态 */
export const qqMusicSession = () => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/session",
  });
};

/** QQ 音乐「我喜欢」分页 */
export const qqMusicLiked = (begin = 0, num = 200) => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/liked",
    params: { begin, num },
  });
};

/** 批量同步到 QQ 音乐「我喜欢」 */
export const qqMusicAddLiked = (mids: string[]) => {
  return request({
    baseURL: "/api/qqmusic",
    url: "/liked",
    method: "post",
    data: { mids },
  });
};
