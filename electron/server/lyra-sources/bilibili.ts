import { createHash } from "node:crypto";
import { DESKTOP_UA, encode, getJson } from "./net";
import type { PlatformSong } from "./platform";

const REFERER = "https://www.bilibili.com/";

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

let cookieHeader = "";
let cookieAt = 0;
let mixinKey = "";
let keyAt = 0;

const md5 = (value: string): string => createHash("md5").update(value, "utf8").digest("hex");

const headers = (extra: Record<string, string> = {}): Record<string, string> => {
  const base: Record<string, string> = {
    Referer: REFERER,
    "User-Agent": DESKTOP_UA,
    Origin: "https://www.bilibili.com",
    ...extra,
  };
  if (cookieHeader) base.Cookie = cookieHeader;
  return base;
};

const ensureCookie = async (): Promise<void> => {
  if (cookieHeader && Date.now() - cookieAt < 3_600_000) return;
  const data = await getJson<any>("https://api.bilibili.com/x/frontend/finger/spi", {
    "User-Agent": DESKTOP_UA,
    Referer: REFERER,
  });
  const b3 = data?.data?.b_3;
  const b4 = data?.data?.b_4;
  if (typeof b3 === "string" && b3) {
    cookieHeader = `buvid3=${b3}${b4 ? `; buvid4=${b4}` : ""}; b_nut=${Math.floor(Date.now() / 1000)}`;
    cookieAt = Date.now();
  }
};

const ensureMixinKey = async (): Promise<string> => {
  if (mixinKey && Date.now() - keyAt < 3_600_000) return mixinKey;
  await ensureCookie();
  const data = await getJson<any>("https://api.bilibili.com/x/web-interface/nav", headers());
  const wbi = data?.data?.wbi_img;
  if (wbi?.img_url && wbi?.sub_url) {
    const imgKey = String(wbi.img_url).split("/").pop()?.split(".")[0] ?? "";
    const subKey = String(wbi.sub_url).split("/").pop()?.split(".")[0] ?? "";
    const raw = imgKey + subKey;
    mixinKey = MIXIN_KEY_ENC_TAB.map((index) => raw[index] ?? "")
      .join("")
      .slice(0, 32);
    keyAt = Date.now();
  }
  return mixinKey;
};

const signedQuery = async (params: Record<string, string>): Promise<string> => {
  const key = await ensureMixinKey();
  const all: Record<string, string> = { ...params, wts: String(Math.floor(Date.now() / 1000)) };
  const query = Object.keys(all)
    .sort()
    .map((name) => {
      const cleaned = String(all[name]).replace(/[!'()*]/g, "");
      return `${name}=${encode(cleaned).replace(/%20/g, "+")}`;
    })
    .join("&");
  return `${query}&w_rid=${md5(query + key)}`;
};

/** B 站视频搜索 */
export const biliSearch = async (keyword: string): Promise<PlatformSong[]> => {
  await ensureCookie();
  const data = await getJson<any>(
    "https://api.bilibili.com/x/web-interface/search/type?search_type=video" +
      `&keyword=${encode(keyword)}&page=1&page_size=30`,
    headers(),
  );
  const list: any[] = data?.data?.result ?? [];
  return list
    .filter((item) => item?.bvid && item?.title)
    .map((item) => ({
      platformId: String(item.bvid),
      name: stripHtml(String(item.title)),
      artist: String(item.author ?? ""),
      album: "哔哩哔哩",
      durationMs: parseClock(item.duration),
      coverUrl: normalizeCover(item.pic),
      hash: String(item.bvid),
    }));
};

const fetchCid = async (bvid: string): Promise<number> => {
  const data = await getJson<any>(
    `https://api.bilibili.com/x/player/pagelist?bvid=${encode(bvid)}`,
    headers(),
  );
  return Number(data?.data?.[0]?.cid ?? 0);
};

/** 解析 B 站音轨直链 */
export const biliResolveUrl = async (
  bvid: string,
): Promise<{ url: string; headers: Record<string, string> } | null> => {
  await ensureCookie();
  const viewQuery = await signedQuery({ bvid });
  const info = await getJson<any>(
    `https://api.bilibili.com/x/web-interface/wbi/view?${viewQuery}`,
    headers(),
  );
  let cid = Number(info?.data?.cid ?? 0);
  if (!cid) cid = await fetchCid(bvid);
  if (!cid) return null;

  const query = await signedQuery({
    bvid,
    cid: String(cid),
    fnval: "1",
    qn: "32",
    platform: "pc",
  });
  const data = await getJson<any>(
    `https://api.bilibili.com/x/player/wbi/playurl?${query}`,
    headers(),
  );
  if (data?.code !== 0) return null;
  const url = data?.data?.durl?.[0]?.url;
  if (typeof url !== "string" || !url.startsWith("http")) return null;
  return { url, headers: { Referer: REFERER, "User-Agent": DESKTOP_UA } };
};

const stripHtml = (value: string): string =>
  value
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .trim();

const normalizeCover = (value: unknown): string | undefined => {
  if (typeof value !== "string" || !value) return undefined;
  if (value.startsWith("//")) return `https:${value}`;
  return value.startsWith("http") ? value : undefined;
};

const parseClock = (value: unknown): number => {
  if (typeof value !== "string") return 0;
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((acc, part) => acc * 60 + part, 0) * 1000;
};
