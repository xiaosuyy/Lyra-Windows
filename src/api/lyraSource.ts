import request from "@/utils/request";

const baseURL = "/api";

export interface LyraScriptSource {
  id: string;
  qualities: string[];
}

export interface LyraScriptInfo {
  id: string;
  name: string;
  version?: string;
  builtin: boolean;
  enabled: boolean;
  ready: boolean;
  error?: string;
  sources: LyraScriptSource[];
}

interface LyraApiResult<T> {
  code: number;
  message?: string;
  data: T;
}

/** 获取音源脚本列表 */
export const getLyraScripts = async () => {
  const response = await request<LyraApiResult<LyraScriptInfo[]>>({
    baseURL,
    url: "/lyra-sources/scripts",
    method: "get",
  });
  return response?.data ?? null;
};

/** 启用或停用音源脚本 */
export const toggleLyraScript = async (id: string, enabled: boolean) => {
  const response = await request<LyraApiResult<LyraScriptInfo[]>>({
    baseURL,
    url: "/lyra-sources/scripts/toggle",
    method: "post",
    data: { id, enabled },
  });
  return response?.data ?? null;
};

/** 通过内容或在线地址导入音源脚本 */
export const importLyraScript = async (payload: {
  url?: string;
  name?: string;
  content?: string;
}) => {
  const response = await request<LyraApiResult<LyraScriptInfo[]>>({
    baseURL,
    url: "/lyra-sources/scripts/import",
    method: "post",
    data: payload,
    timeout: 30000,
  });
  return response?.data ?? null;
};

/** 删除自定义音源脚本 */
export const removeLyraScript = async (id: string) => {
  const response = await request<LyraApiResult<LyraScriptInfo[]>>({
    baseURL,
    url: `/lyra-sources/scripts/${encodeURIComponent(id)}`,
    method: "delete",
  });
  return response?.data ?? null;
};

/** 重新加载内置音源 */
export const reloadLyraScripts = async () => {
  const response = await request<LyraApiResult<LyraScriptInfo[]>>({
    baseURL,
    url: "/lyra-sources/reload",
    method: "post",
  });
  return response?.data ?? null;
};
