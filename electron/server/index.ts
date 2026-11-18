import { app } from "electron";
import { join } from "path";
import { createReadStream, existsSync } from "fs";
import { isDev } from "../main/utils/config";
import { serverLog } from "../main/logger";
import { initNcmAPI } from "./netease";
import { initUnblockAPI } from "./unblock";
import { initLyraSourceAPI } from "./lyra-sources/api";
import { initControlAPI } from "./control";
import { initQQMusicAPI } from "./qqmusic";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastify from "fastify";

/** 形态页资源目录：内含 stages/ 与 segdict.bin，开发取仓库旁资源，打包后取 resources/stages */
const resolveStageRoot = (): string | null => {
  const candidates = [
    process.env.LYRA_STAGE_DIR,
    join(process.resourcesPath, "stages"),
    join(app.getAppPath(), "..", "LIZI", "resources", "app", "public"),
    join(app.getAppPath(), "..", "..", "LIZI", "resources", "app", "public"),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (existsSync(join(dir, "stages"))) return dir;
  }
  return null;
};

const initAppServer = async () => {
  try {
    const server = fastify({
      routerOptions: {
        // 忽略尾随斜杠
        ignoreTrailingSlash: true,
      },
    });
    // 注册插件
    server.register(fastifyCookie);
    server.register(fastifyMultipart);
    // 生产环境启用静态文件
    if (!isDev) {
      serverLog.info("📂 Serving static files from /renderer");
      server.register(fastifyStatic, {
        root: join(__dirname, "../renderer"),
      });
    }
    // 播放形态页（/player-stages/*.html）
    const stageRoot = resolveStageRoot();
    if (stageRoot) {
      serverLog.info("📂 Serving player stages from /player-stages");
      server.register(fastifyStatic, {
        root: join(stageRoot, "stages"),
        prefix: "/player-stages/",
        // 与上面渲染进程静态目录共用 reply.sendFile，避免重复装饰
        decorateReply: false,
        cacheControl: true,
        maxAge: 604800000,
      });
      // 部分形态按根路径读取分词词典
      server.get("/segdict.bin", (_, reply) => {
        reply.header("Content-Type", "application/octet-stream");
        reply.header("Cache-Control", "public, max-age=604800");
        return reply.send(createReadStream(join(stageRoot, "segdict.bin")));
      });
    } else {
      serverLog.warn("⚠️ Player stages not found, 形态页将不可用");
    }
    // 声明
    server.get("/api", (_, reply) => {
      reply.send({
        name: "Lyra API",
        description: "Lyra API service",
        author: "@imsyy",
        list: [
          {
            name: "NeteaseCloudMusicApi",
            url: "/api/netease",
          },
          {
            name: "UnblockAPI",
            url: "/api/unblock",
          },
          {
            name: "ControlAPI",
            url: "/api/control",
          },
          {
            name: "QQMusicAPI",
            url: "/api/qqmusic",
          },
          {
            name: "LyraSourceAPI",
            url: "/api/lyra-sources",
          },
        ],
      });
    });
    // 注册接口
    server.register(initNcmAPI, { prefix: "/api" });
    server.register(initUnblockAPI, { prefix: "/api" });
    server.register(initControlAPI, { prefix: "/api" });
    server.register(initQQMusicAPI, { prefix: "/api" });
    server.register(initLyraSourceAPI, { prefix: "/api" });
    // 启动端口
    const port = Number(process.env["VITE_SERVER_PORT"] || 25884);
    await server.listen({ port, host: "127.0.0.1" });
    serverLog.info(`🌐 Starting AppServer on port ${port}`);
    return server;
  } catch (error) {
    serverLog.error("🚫 AppServer failed to start");
    throw error;
  }
};

export default initAppServer;
