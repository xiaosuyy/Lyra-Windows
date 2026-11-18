export const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface HttpResult {
  ok: boolean;
  status: number;
  statusMessage: string;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
}

export async function httpRequest(url: string, options: RequestOptions = {}): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  try {
    const headers: Record<string, string> = {
      "User-Agent": DESKTOP_UA,
      ...(options.headers ?? {}),
    };
    const requestBody: BodyInit | undefined =
      typeof options.body === "string"
        ? options.body
        : options.body
          ? new Uint8Array(options.body)
          : undefined;
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: requestBody,
      signal: controller.signal,
      redirect: "follow",
    });
    const headerMap: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headerMap[key] = value;
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusMessage: response.statusText,
      headers: headerMap,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusMessage: "",
      headers: {},
      body: "",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getText(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 30000,
): Promise<string | null> {
  const response = await httpRequest(url, { headers, timeoutMs });
  return response.ok ? response.body : null;
}

export async function getJson<T = any>(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 30000,
): Promise<T | null> {
  const text = await getText(url, headers, timeoutMs);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function encode(value: string): string {
  return encodeURIComponent(value);
}

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
