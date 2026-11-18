import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Readable } from "node:stream";
import { biliResolveUrl } from "../lyra-sources/bilibili";
import { resolveLyraSongUrl } from "../lyra-sources";
import type { LyraSource } from "../lyra-sources/lx";
import { serverLog } from "../../main/logger";

/** 支持的音源 */
const LYRA_SOURCES: LyraSource[] = ["netease", "tencent", "kugou", "kuwo", "migu", "bilibili"];

/** B 站直链缓存 */
const biliCache = new Map<string, { url: string; headers: Record<string, string>; at: number }>();

/** 构造匹配信息（兼容歌名含连字符的情况） */
const buildMatchInfo = (query: { [key: string]: string }) => {
  let songName = query.songName || "";
  let artist = query.artist || "";
  if (!songName && query.keyword) {
    const lastIdx = query.keyword.lastIndexOf("-");
    if (lastIdx > 0) {
      songName = query.keyword.slice(0, lastIdx).trim();
      artist = artist || query.keyword.slice(lastIdx + 1).trim();
    } else {
      songName = query.keyword.trim();
    }
  }
  return {
    songName,
    artist,
    durationMs: Number(query.duration || 0),
    neteaseId: query.id && query.id !== "0" ? query.id : undefined,
  };
};

// 初始化 UnblockAPI
export const initUnblockAPI = async (fastify: FastifyInstance) => {
  // 主信息
  fastify.get("/unblock", (_, reply) => {
    reply.send({
      name: "UnblockAPI",
      description: "Lyra UnblockAPI service",
      author: "Lyra",
      sources: LYRA_SOURCES,
      content: "音源来自 Lyra 手机端内置自定义音源脚本，仅供个人学习使用。",
    });
  });

  // 各音源解锁
  fastify.get(
    "/unblock/:source",
    async (
      req: FastifyRequest<{ Params: { source: string }; Querystring: { [key: string]: string } }>,
      reply: FastifyReply,
    ) => {
      const source = req.params.source as LyraSource;
      if (!LYRA_SOURCES.includes(source)) {
        return reply.code(404).send({ code: 404, url: null });
      }
      const match = buildMatchInfo(req.query);
      const host = req.headers.host ?? "127.0.0.1";
      const proxyBase = /^https?:\/\//.test(host) ? host : `http://${host}`;
      const result = await resolveLyraSongUrl(source, { ...match, proxyBase });
      return reply.send(result);
    },
  );

  // B 站音频代理（带 Referer，支持 Range 拖动）
  fastify.get(
    "/unblock/bili/play",
    async (req: FastifyRequest<{ Querystring: { bvid?: string } }>, reply: FastifyReply) => {
      const bvid = req.query.bvid;
      if (!bvid || !/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
        return reply.code(400).send({ code: 400, message: "invalid bvid" });
      }
      let cached = biliCache.get(bvid);
      if (!cached || Date.now() - cached.at > 5 * 60 * 1000) {
        const resolved = await biliResolveUrl(bvid);
        if (!resolved) return reply.code(404).send({ code: 404, message: "no audio" });
        cached = { ...resolved, at: Date.now() };
        biliCache.set(bvid, cached);
      }
      const range = req.headers.range;
      const upstream = await fetch(cached.url, {
        headers: { ...cached.headers, ...(range ? { Range: range } : {}) },
      }).catch(() => null);
      if (!upstream || !upstream.body) {
        return reply.code(502).send({ code: 502, message: "upstream error" });
      }
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const value = upstream.headers.get(name);
        if (value) reply.header(name, value);
      }
      reply.code(upstream.status);
      return reply.send(Readable.fromWeb(upstream.body as any));
    },
  );

  serverLog.info("🌐 Register UnblockAPI successfully");
};
