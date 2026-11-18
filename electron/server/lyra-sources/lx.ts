import { app } from "electron";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import vm from "node:vm";
import { httpRequest } from "./net";

/** Lyra 手机端支持的音源 */
export type LyraSource = "netease" | "tencent" | "kugou" | "kuwo" | "migu" | "bilibili";

/** 平台音源与 LX 脚本音源 id 的映射 */
export const SCRIPT_SOURCE_ID: Record<LyraSource, string> = {
  netease: "wy",
  tencent: "tx",
  kugou: "kg",
  kuwo: "kw",
  migu: "mg",
  bilibili: "",
};

/** 音质尝试顺序 */
const QUALITY_PREFERENCE = ["320k", "128k", "192k", "flac", "flac24bit"];
const URL_CACHE_TTL = 10 * 60 * 1000;
const FAIL_CACHE_TTL = 60 * 1000;
const RESOLVE_TIMEOUT = 15000;
const INVOKE_TIMEOUT = 7000;
const AUDIO_EXT_RE = /\.(mp3|flac|m4a|aac|wav|ogg|opus|weba|m4s|ape|wma)(?:[?#]|$)/i;

/** 只接受可直接播放的音频直链，过滤网页地址 */
export const isPlayableAudioUrl = (value: string): boolean => {
  if (!/^https?:\/\//i.test(value)) return false;
  if (/kugou\.com\/song|music\.163\.com\/song|y\.qq\.com\/n\/ryqq/i.test(value)) return false;
  try {
    const url = new URL(value);
    if (AUDIO_EXT_RE.test(url.pathname)) return true;
    return /(?:^|\.)(?:music|stream|audio|dl|freetyst|ws)\./i.test(url.hostname);
  } catch {
    return false;
  }
};

/** 平台歌曲信息 */
export interface LyraSongMeta {
  platformId: string;
  hash?: string;
  name: string;
  artist: string;
  album?: string;
  albumId?: string;
  albumAudioId?: string;
  durationMs?: number;
}

interface Declaration {
  id: string;
  qualities: string[];
}

interface ScriptMeta {
  id: string;
  name: string;
  version?: string;
  file: string;
  builtin: boolean;
}

/** 音源脚本信息（供设置页展示） */
export interface LyraScriptInfo {
  id: string;
  name: string;
  version?: string;
  builtin: boolean;
  enabled: boolean;
  ready: boolean;
  error?: string;
  sources: { id: string; qualities: string[] }[];
}

const SCRIPT_NAME_RE = /@name\s+([^\r\n*]+)/;
const SCRIPT_VERSION_RE = /@version\s+([^\r\n*]+)/;

/** 从脚本头注释提取名称与版本 */
const extractScriptMeta = (content: string) => ({
  name: content.match(SCRIPT_NAME_RE)?.[1]?.trim() || "",
  version: content.match(SCRIPT_VERSION_RE)?.[1]?.trim() || undefined,
});

/** 生成安全的脚本文件名 */
const safeScriptName = (value?: string) => {
  const base = basename(String(value ?? "").trim())
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, "_")
    .replace(/^[._]+/, "");
  if (!base) return `imported-${Date.now()}.js`;
  return base.toLowerCase().endsWith(".js") ? base : `${base}.js`;
};

const PRELUDE = String.raw`
(function () {
  var host = globalThis.__lyraHost;
  if (!host) throw new Error('Lyra host bridge missing');
  var g = globalThis;
  g.window = g; g.self = g; g.global = g;
  g.navigator = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' };
  g.location = { href: 'https://music.163.com/', protocol: 'https:', host: 'music.163.com' };
  g.document = { cookie: '', createElement: function () { return { style: {}, appendChild: function () {}, setAttribute: function () {} }; } };

  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function bytesToBase64(bytes) {
    var output = '', i = 0;
    while (i < bytes.length) {
      var b0 = bytes[i++] & 0xff;
      var b1 = i < bytes.length ? bytes[i++] & 0xff : NaN;
      var b2 = i < bytes.length ? bytes[i++] & 0xff : NaN;
      output += B64_CHARS.charAt(b0 >> 2);
      output += B64_CHARS.charAt(((b0 & 3) << 4) | (isNaN(b1) ? 0 : b1 >> 4));
      output += isNaN(b1) ? '=' : B64_CHARS.charAt(((b1 & 15) << 2) | (isNaN(b2) ? 0 : b2 >> 6));
      output += isNaN(b2) ? '=' : B64_CHARS.charAt(b2 & 63);
    }
    return output;
  }
  function base64ToBytes(text) {
    var clean = String(text).replace(/[^A-Za-z0-9+/=]/g, '');
    var bytes = [];
    for (var i = 0; i < clean.length; i += 4) {
      var c0 = B64_CHARS.indexOf(clean.charAt(i));
      var c1 = B64_CHARS.indexOf(clean.charAt(i + 1));
      var c2 = B64_CHARS.indexOf(clean.charAt(i + 2));
      var c3 = B64_CHARS.indexOf(clean.charAt(i + 3));
      bytes.push(((c0 << 2) | (c1 >> 4)) & 0xff);
      if (c2 >= 0) bytes.push((((c1 & 15) << 4) | (c2 >> 2)) & 0xff);
      if (c3 >= 0) bytes.push((((c2 & 3) << 6) | c3) & 0xff);
    }
    return new Uint8Array(bytes);
  }
  function stringToBytes(input) {
    var bytes = [];
    for (var i = 0; i < input.length; i++) {
      var code = input.charCodeAt(i);
      if (code < 128) bytes.push(code);
      else if (code < 2048) bytes.push((code >> 6) | 192, (code & 63) | 128);
      else bytes.push((code >> 12) | 224, ((code >> 6) & 63) | 128, (code & 63) | 128);
    }
    return bytes;
  }
  function bytesToString(bytes) {
    var result = '', i = 0;
    while (i < bytes.length) {
      var byte = bytes[i];
      if (byte < 128) { result += String.fromCharCode(byte); i++; }
      else if (byte >= 192 && byte < 224) { result += String.fromCharCode(((byte & 31) << 6) | (bytes[i + 1] & 63)); i += 2; }
      else { result += String.fromCharCode(((byte & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3; }
    }
    return result;
  }
  g.btoa = function (input) { return bytesToBase64(stringToBytes(String(input))); };
  g.atob = function (input) { return bytesToString(base64ToBytes(input)); };

  g.console = {
    log: function () { host.log(Array.prototype.slice.call(arguments).map(String).join(' ')); },
    info: function () { host.log(Array.prototype.slice.call(arguments).map(String).join(' ')); },
    warn: function () { host.log('WARN ' + Array.prototype.slice.call(arguments).map(String).join(' ')); },
    error: function () { host.log('ERROR ' + Array.prototype.slice.call(arguments).map(String).join(' ')); },
    debug: function () { host.log(Array.prototype.slice.call(arguments).map(String).join(' ')); }
  };

  var EVENT_NAMES = { request: 'request', inited: 'inited', updateAlert: 'updateAlert' };
  var eventNames = [EVENT_NAMES.request, EVENT_NAMES.inited, EVENT_NAMES.updateAlert];
  var events = { request: null };

  var utils = {
    crypto: {
      md5: function (str) {
        if (typeof str !== 'string') throw new Error('param required a string');
        return host.md5(encodeURIComponent(str));
      },
      randomBytes: function (size) {
        var byteArray = new Uint8Array(size);
        for (var i = 0; i < size; i++) byteArray[i] = Math.floor(Math.random() * 256);
        return byteArray;
      },
      aesEncrypt: function () { throw new Error('aesEncrypt is not supported'); },
      rsaEncrypt: function () { throw new Error('rsaEncrypt is not supported'); }
    },
    buffer: {
      from: function (input, encoding) {
        if (typeof input === 'string') {
          switch (encoding) {
            case 'base64': return base64ToBytes(input);
            case 'hex': {
              var matched = input.match(/.{1,2}/g) || [];
              return new Uint8Array(matched.map(function (byte) { return parseInt(byte, 16); }));
            }
            default: return new Uint8Array(stringToBytes(input));
          }
        }
        if (Array.isArray(input) || ArrayBuffer.isView(input)) return new Uint8Array(input);
        throw new Error('Unsupported input type: ' + input + ' encoding: ' + encoding);
      },
      bufToString: function (buf, format) {
        if (Array.isArray(buf) || ArrayBuffer.isView(buf)) {
          var bytes = Array.from(new Uint8Array(buf.buffer || buf));
          switch (format) {
            case 'binary': return buf;
            case 'hex': return bytes.reduce(function (text, byte) { return text + byte.toString(16).padStart(2, '0'); }, '');
            case 'base64': return bytesToBase64(bytesToString(bytes));
            case 'utf8':
            case 'utf-8':
            default: return bytesToString(bytes);
          }
        }
        throw new Error('Input is not a valid buffer: ' + buf + ' format: ' + format);
      }
    }
  };

  g.lx = {
    EVENT_NAMES: EVENT_NAMES,
    env: 'desktop',
    version: '2.0.0',
    currentScriptInfo: JSON.parse(host.scriptInfo()),
    utils: utils,
    request: function (url, options, callback) {
      var cancelled = false;
      host.http(JSON.stringify({ url: String(url), options: options || {} }))
        .then(function (json) {
          if (cancelled) return;
          var payload = JSON.parse(json);
          if (!payload.ok) {
            callback(new Error(payload.error || 'request failed'), null, null);
            return;
          }
          var response = {
            statusCode: payload.statusCode,
            statusMessage: payload.statusMessage,
            headers: payload.headers || {},
            body: payload.body
          };
          callback(null, response, payload.body);
        })
        .catch(function (error) {
          if (!cancelled) callback(new Error(String(error && error.message ? error.message : error)), null, null);
        });
      return function () { cancelled = true; };
    },
    send: function (eventName, data) {
      return new Promise(function (resolve, reject) {
        if (eventNames.indexOf(eventName) === -1) {
          reject(new Error('The event is not supported: ' + eventName));
          return;
        }
        if (eventName === EVENT_NAMES.inited) {
          host.inited(JSON.stringify(data || {}));
          resolve();
          return;
        }
        if (eventName === EVENT_NAMES.updateAlert) { resolve(); return; }
        reject(new Error('Unknown event name: ' + eventName));
      });
    },
    on: function (eventName, handler) {
      return new Promise(function (resolve, reject) {
        if (eventName === EVENT_NAMES.request) {
          events.request = handler;
          resolve();
          return;
        }
        reject(new Error('The event is not supported: ' + eventName));
      });
    }
  };

  g.__lyraInvoke = function (json) {
    var payload = JSON.parse(json);
    if (!events.request) throw new Error('音源未注册 request 事件');
    return Promise.resolve(events.request.call(g.lx, {
      source: payload.source,
      action: payload.action,
      info: payload.info
    }));
  };
})();
`;

class SourceEngine {
  meta: ScriptMeta;
  declarations: Declaration[] = [];
  error?: string;
  ready = false;
  private context?: vm.Context;
  private sandbox: Record<string, unknown> = {};
  private inited?: (value: Declaration[]) => void;

  constructor(meta: ScriptMeta) {
    this.meta = meta;
  }

  async load(): Promise<Declaration[]> {
    const script = await readFile(this.meta.file, "utf8").catch(() => "");
    if (!script) {
      this.error = "脚本文件读取失败";
      return [];
    }
    const initedPromise = new Promise<Declaration[]>((resolve) => {
      this.inited = resolve;
    });

    const host = {
      log: () => undefined,
      md5: (value: string) => createHash("md5").update(String(value), "utf8").digest("hex"),
      scriptInfo: () =>
        JSON.stringify({
          name: this.meta.name,
          description: this.meta.name,
          version: "1.0.0",
          author: "",
          homepage: "",
        }),
      inited: (json: string) => {
        try {
          const payload = JSON.parse(json);
          const declarations: Declaration[] = [];
          const sources = payload?.sources ?? {};
          for (const key of Object.keys(sources)) {
            const qualities = Array.isArray(sources[key]?.qualitys)
              ? sources[key].qualitys.filter((q: unknown) => typeof q === "string")
              : [];
            declarations.push({ id: key, qualities });
          }
          this.declarations = declarations;
          this.inited?.(declarations);
        } catch {
          this.inited?.([]);
        }
      },
      http: (json: string) => this.performRequest(json),
    };

    this.sandbox = {
      __lyraHost: host,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      TextEncoder,
      TextDecoder,
      URL,
      URLSearchParams,
      Promise,
      atob: (value: string) => Buffer.from(String(value), "base64").toString("binary"),
      btoa: (value: string) => Buffer.from(String(value), "binary").toString("base64"),
    };
    this.context = vm.createContext(this.sandbox, { name: `lyra-source-${this.meta.id}` });

    try {
      vm.runInContext(PRELUDE, this.context, { timeout: 10000 });
      vm.runInContext(script, this.context, { timeout: 60000, filename: this.meta.file });
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return [];
    }

    const declarations = await Promise.race([
      initedPromise,
      new Promise<Declaration[]>((resolve) => setTimeout(() => resolve([]), 45000)),
    ]);
    if (!declarations.length) {
      this.error = this.error ?? "脚本未声明音源（可能已失效）";
      return [];
    }
    this.ready = true;
    return declarations;
  }

  /** 代理脚本内的网络请求 */
  private async performRequest(json: string): Promise<string> {
    let payload: any;
    try {
      payload = JSON.parse(json);
    } catch {
      return JSON.stringify({ ok: false, error: "bad request payload" });
    }
    const url = String(payload?.url ?? "");
    if (!url) return JSON.stringify({ ok: false, error: "missing url" });
    const options = payload?.options ?? {};
    const headers: Record<string, string> = {};
    if (options.headers && typeof options.headers === "object") {
      for (const key of Object.keys(options.headers)) {
        headers[key] = String(options.headers[key]);
      }
    }
    if (options.timeout === 0) return JSON.stringify({ ok: false, error: "request aborted" });

    let body: string | undefined;
    if (options.form && typeof options.form === "object") {
      const params = new URLSearchParams();
      for (const key of Object.keys(options.form)) {
        params.append(key, String(options.form[key]));
      }
      body = params.toString();
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    } else if (typeof options.body === "string") {
      body = options.body;
    } else if (options.body && typeof options.body === "object") {
      body = JSON.stringify(options.body);
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }

    const response = await httpRequest(url, {
      method: String(options.method ?? "GET").toUpperCase(),
      headers,
      body,
      timeoutMs: Number(options.timeout) > 0 ? Number(options.timeout) : 30000,
    });
    if (!response.ok && response.error) {
      return JSON.stringify({ ok: false, error: response.error });
    }
    return JSON.stringify({
      ok: true,
      statusCode: response.status,
      statusMessage: response.statusMessage,
      headers: response.headers,
      body: response.body,
    });
  }

  /** 调用脚本取播放地址 */
  async invoke(payload: unknown, timeoutMs = INVOKE_TIMEOUT): Promise<any> {
    if (!this.ready || !this.context) throw new Error("音源未就绪");
    const expression = `__lyraInvoke(${JSON.stringify(JSON.stringify(payload))})`;
    const result = vm.runInContext(expression, this.context, { timeout: timeoutMs });
    return await Promise.race([
      Promise.resolve(result),
      new Promise((_, reject) => setTimeout(() => reject(new Error("取链超时")), timeoutMs)),
    ]);
  }
}

/**
 * LX 自定义音源管理器（与 Lyra 手机端内置脚本一致）
 */
class LxSourceManager {
  private engines = new Map<string, SourceEngine>();
  private allEngines: SourceEngine[] = [];
  private loading?: Promise<void>;
  private urlCache = new Map<string, { url: string; at: number }>();
  private failCache = new Map<string, number>();
  /** 已停用的脚本 id */
  private disabled = new Set<string>();
  /** 脚本自定义顺序 */
  private order: string[] = [];
  private configReady?: Promise<void>;

  /** 用户自定义脚本目录 */
  private customDir(): string {
    return join(app.getPath("userData"), "lyra-sources", "scripts");
  }

  private configFile(): string {
    return join(app.getPath("userData"), "lyra-sources", "config.json");
  }

  /** 读取用户配置 */
  private ensureConfig(): Promise<void> {
    if (this.configReady) return this.configReady;
    this.configReady = (async () => {
      await mkdir(this.customDir(), { recursive: true }).catch(() => undefined);
      try {
        const raw = await readFile(this.configFile(), "utf8");
        const data = JSON.parse(raw) as { disabled?: unknown; order?: unknown };
        if (Array.isArray(data.disabled)) {
          this.disabled = new Set(
            data.disabled.filter((id): id is string => typeof id === "string"),
          );
        }
        if (Array.isArray(data.order)) {
          this.order = data.order.filter((id): id is string => typeof id === "string");
        }
      } catch {
        // 首次运行没有配置文件
      }
    })();
    return this.configReady;
  }

  private async saveConfig(): Promise<void> {
    await mkdir(this.customDir(), { recursive: true }).catch(() => undefined);
    const payload = { disabled: [...this.disabled], order: this.order };
    await writeFile(this.configFile(), JSON.stringify(payload, null, 2), "utf8");
  }

  /** 内置脚本目录 */
  private scriptDirs(): string[] {
    const dirs = [
      join(process.resourcesPath ?? "", "sources"),
      join(app.getAppPath(), "resources", "sources"),
      join(process.cwd(), "resources", "sources"),
    ];
    return [...new Set(dirs)].filter((dir) => dir && existsSync(dir));
  }

  /** 加载全部内置与用户脚本 */
  async ensureLoaded(): Promise<void> {
    if (this.engines.size > 0) return;
    if (this.loading) return this.loading;
    this.loading = this.doLoad().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  private async doLoad(): Promise<void> {
    await this.ensureConfig();
    const files = new Map<string, { file: string; builtin: boolean }>();
    for (const dir of this.scriptDirs()) {
      const entries = await readdir(dir).catch(() => [] as string[]);
      for (const file of entries) {
        if (!file.endsWith(".js") || files.has(file)) continue;
        files.set(file, { file: join(dir, file), builtin: true });
      }
    }
    const customEntries = await readdir(this.customDir()).catch(() => [] as string[]);
    for (const file of customEntries) {
      if (file.endsWith(".js"))
        files.set(file, { file: join(this.customDir(), file), builtin: false });
    }
    // 固定脚本优先级
    const priority = ["changqing.js", "kxh.js", "xinghai.js"];
    const list = [...files.entries()];
    list.sort(([a], [b]) => {
      const ao = this.order.indexOf(a);
      const bo = this.order.indexOf(b);
      if (ao !== -1 || bo !== -1) return (ao === -1 ? 999 : ao) - (bo === -1 ? 999 : bo);
      const ai = priority.indexOf(a);
      const bi = priority.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    for (const [id, entry] of list) {
      const content = await readFile(entry.file, "utf8").catch(() => "");
      const header = extractScriptMeta(content);
      const engine = new SourceEngine({
        id,
        name: header.name || basename(id, ".js"),
        version: header.version,
        file: entry.file,
        builtin: entry.builtin,
      });
      await engine.load();
      this.allEngines.push(engine);
      if (engine.ready) this.engines.set(id, engine);
    }
  }

  /** 音源脚本列表 */
  async listScripts(): Promise<LyraScriptInfo[]> {
    await this.ensureLoaded();
    return this.allEngines.map((engine) => ({
      id: engine.meta.id,
      name: engine.meta.name,
      version: engine.meta.version,
      builtin: engine.meta.builtin,
      enabled: !this.disabled.has(engine.meta.id),
      ready: engine.ready,
      error: engine.error,
      sources: engine.declarations.map((item) => ({ id: item.id, qualities: item.qualities })),
    }));
  }

  /** 启用/停用脚本 */
  async setScriptEnabled(id: string, enabled: boolean): Promise<LyraScriptInfo[]> {
    await this.ensureConfig();
    if (!this.allEngines.some((engine) => engine.meta.id === id)) {
      throw new Error("音源脚本不存在");
    }
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
    await this.saveConfig();
    return this.listScripts();
  }

  /** 重置并重新加载全部脚本 */
  async reload(): Promise<LyraScriptInfo[]> {
    this.engines.clear();
    this.allEngines = [];
    this.loading = undefined;
    this.urlCache.clear();
    this.failCache.clear();
    await this.ensureLoaded();
    return this.listScripts();
  }

  /** 导入音源脚本 */
  async importScript(content: string, fileName?: string): Promise<LyraScriptInfo[]> {
    const script = String(content ?? "").trim();
    if (!script) throw new Error("脚本内容为空");
    if (script.length > 4 * 1024 * 1024) throw new Error("脚本体积过大");
    if (!/musicUrl|lx\.send|lx\.on/.test(script)) throw new Error("不是有效的 LX 音源脚本");
    await this.ensureConfig();
    await mkdir(this.customDir(), { recursive: true }).catch(() => undefined);

    let name = safeScriptName(fileName);
    const builtinNames = new Set(
      this.allEngines.filter((engine) => engine.meta.builtin).map((engine) => engine.meta.id),
    );
    if (builtinNames.has(name)) name = `custom-${name}`;
    let target = join(this.customDir(), name);
    let index = 2;
    while (existsSync(target)) {
      target = join(this.customDir(), name.replace(/(\.js)$/i, `-${index}$1`));
      index += 1;
    }
    await writeFile(target, script, "utf8");
    this.disabled.delete(basename(target));
    await this.saveConfig();
    const list = await this.reload();
    const imported = list.find((item) => item.id === basename(target));
    if (!imported?.ready) {
      throw new Error(imported?.error || "音源脚本加载失败");
    }
    return list;
  }

  /** 删除自定义脚本 */
  async removeScript(id: string): Promise<LyraScriptInfo[]> {
    await this.ensureConfig();
    const engine = this.allEngines.find((item) => item.meta.id === id);
    if (!engine) throw new Error("音源脚本不存在");
    if (engine.meta.builtin) throw new Error("内置音源不能删除，可在开关中停用");
    await rm(engine.meta.file, { force: true });
    this.disabled.delete(id);
    this.order = this.order.filter((item) => item !== id);
    await this.saveConfig();
    return this.reload();
  }

  /** 当前启用且提供该音源的全部脚本 */
  private readyEnginesFor(source: LyraSource): SourceEngine[] {
    const scriptId = SCRIPT_SOURCE_ID[source];
    if (!scriptId) return [];
    return this.allEngines.filter(
      (engine) =>
        engine.ready &&
        !this.disabled.has(engine.meta.id) &&
        engine.declarations.some((item) => item.id === scriptId),
    );
  }

  /** 当前脚本是否提供该音源 */
  async hasSource(source: LyraSource): Promise<boolean> {
    await this.ensureLoaded();
    return this.readyEnginesFor(source).length > 0;
  }

  private qualitiesFor(source: LyraSource): string[] {
    const scriptId = SCRIPT_SOURCE_ID[source];
    const all = new Set<string>();
    for (const engine of this.readyEnginesFor(source)) {
      for (const declaration of engine.declarations) {
        if (declaration.id !== scriptId) continue;
        for (const quality of declaration.qualities) all.add(quality);
      }
    }
    return [
      ...QUALITY_PREFERENCE.filter((quality) => all.has(quality)),
      ...[...all].filter((quality) => !QUALITY_PREFERENCE.includes(quality)),
    ];
  }

  /** 通过脚本解析播放地址 */
  async resolve(
    source: LyraSource,
    song: LyraSongMeta,
  ): Promise<{ url: string; quality: string } | null> {
    if (source === "bilibili") return null;
    const scriptId = SCRIPT_SOURCE_ID[source];
    if (!scriptId) return null;
    await this.ensureLoaded();
    if (this.readyEnginesFor(source).length === 0) return null;

    const cacheKey = `${scriptId}|${song.platformId}|${song.hash ?? ""}`;
    const cached = this.urlCache.get(cacheKey);
    if (cached && Date.now() - cached.at < URL_CACHE_TTL) {
      return { url: cached.url, quality: "cached" };
    }
    const failedAt = this.failCache.get(cacheKey);
    if (failedAt && Date.now() - failedAt < FAIL_CACHE_TTL) return null;

    const qualities = this.qualitiesFor(source).slice(0, 3);
    if (qualities.length === 0) return null;

    const musicInfo = {
      source: scriptId,
      songmid: song.platformId,
      songId: song.platformId,
      id: song.platformId,
      hash: song.hash || song.platformId,
      album_id: song.albumId ?? "",
      albumId: song.albumId ?? "",
      album_audio_id: song.albumAudioId || song.platformId,
      copyrightId: song.platformId,
      name: song.name,
      songname: song.name,
      singer: song.artist,
      singername: song.artist,
      albumName: song.album ?? "",
      duration: Math.floor((song.durationMs ?? 0) / 1000),
      interval: Math.floor((song.durationMs ?? 0) / 1000),
      durationMs: song.durationMs ?? 0,
    };

    const engines = this.readyEnginesFor(source);
    const deadline = Date.now() + RESOLVE_TIMEOUT;

    for (const quality of qualities) {
      if (Date.now() >= deadline) break;
      const timeout = Math.min(INVOKE_TIMEOUT, deadline - Date.now());
      const url = await Promise.any(
        engines.map(async (engine) => {
          const value = await engine.invoke(
            {
              source: scriptId,
              action: "musicUrl",
              info: { type: quality, musicInfo },
            },
            timeout,
          );
          const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
          if (!isPlayableAudioUrl(text)) throw new Error("invalid url");
          return text;
        }),
      ).catch(() => null);
      if (url) {
        this.urlCache.set(cacheKey, { url, at: Date.now() });
        this.failCache.delete(cacheKey);
        return { url, quality };
      }
    }
    this.failCache.set(cacheKey, Date.now());
    return null;
  }
}

export const lxSourceManager = new LxSourceManager();
