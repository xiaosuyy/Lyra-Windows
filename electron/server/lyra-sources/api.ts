import { FastifyInstance, FastifyReply } from "fastify";
import { lxSourceManager } from "./lx";
import { httpRequest } from "./net";
import { serverLog } from "../../main/logger";

const sendError = (reply: FastifyReply, status: number, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return reply.code(status).send({ code: status, message });
};

/** 音源脚本管理接口 */
export const initLyraSourceAPI = async (fastify: FastifyInstance) => {
  // 脚本列表
  fastify.get("/lyra-sources/scripts", async (_, reply) => {
    try {
      return reply.send({ code: 200, data: await lxSourceManager.listScripts() });
    } catch (error) {
      return sendError(reply, 500, error);
    }
  });

  // 启用 / 停用脚本
  fastify.post<{ Body: { id?: string; enabled?: boolean } }>(
    "/lyra-sources/scripts/toggle",
    async (req, reply) => {
      const id = String(req.body?.id ?? "");
      if (!id) return sendError(reply, 400, "缺少脚本 id");
      try {
        const data = await lxSourceManager.setScriptEnabled(id, req.body.enabled !== false);
        return reply.send({ code: 200, data });
      } catch (error) {
        return sendError(reply, 400, error);
      }
    },
  );

  // 导入脚本（内容或在线地址）
  fastify.post<{ Body: { url?: string; name?: string; content?: string } }>(
    "/lyra-sources/scripts/import",
    async (req, reply) => {
      const url = String(req.body?.url ?? "").trim();
      let content = String(req.body?.content ?? "");
      let name = req.body?.name;
      try {
        if (!content && url) {
          if (!/^https?:\/\//i.test(url)) return sendError(reply, 400, "请输入有效的脚本地址");
          const response = await httpRequest(url, { timeoutMs: 20000 });
          if (!response.ok || !response.body) {
            return sendError(reply, 400, response.error || `下载脚本失败（${response.status}）`);
          }
          content = response.body;
          name = safeNameFromUrl(url);
        }
        const data = await lxSourceManager.importScript(content, name);
        serverLog.info(`🔌 导入音源脚本：${name || "自定义脚本"}`);
        return reply.send({ code: 200, data });
      } catch (error) {
        return sendError(reply, 400, error);
      }
    },
  );

  // 删除自定义脚本
  fastify.delete<{ Params: { id: string } }>("/lyra-sources/scripts/:id", async (req, reply) => {
    try {
      const data = await lxSourceManager.removeScript(decodeURIComponent(req.params.id));
      return reply.send({ code: 200, data });
    } catch (error) {
      return sendError(reply, 400, error);
    }
  });

  // 重新加载全部脚本
  fastify.post("/lyra-sources/reload", async (_, reply) => {
    try {
      return reply.send({ code: 200, data: await lxSourceManager.reload() });
    } catch (error) {
      return sendError(reply, 500, error);
    }
  });

  serverLog.info("🌐 Register LyraSourceAPI successfully");
};

/** 从 URL 推断脚本文件名 */
const safeNameFromUrl = (url: string) => {
  try {
    const path = new URL(url).pathname;
    const name = path.split("/").filter(Boolean).pop() || "";
    return name.toLowerCase().endsWith(".js") ? name : `${name || "imported"}.js`;
  } catch {
    return undefined;
  }
};
