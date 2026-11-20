import { createHash, createHmac } from "node:crypto";
export function signedHeaders(
  path: string,
  payload: string,
  token = "",
  timestamp = Math.floor(Date.now() / 1000).toString(),
) {
  const headers = { platform: "3", timestamp, dId: "", vName: "1.0.0" };
  const digest = createHmac("sha256", token)
    .update(path + payload + timestamp + JSON.stringify(headers), "utf8")
    .digest("hex");
  return {
    ...headers,
    sign: createHash("md5").update(digest, "utf8").digest("hex"),
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
    Origin: "https://wiki.skland.com",
    Referer: "https://wiki.skland.com/",
  };
}
export class HttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}
export class BusinessError extends Error {
  code: number;
  status: number;
  constructor(code: number, message: string, status = 200) {
    super(`业务错误 ${code}: ${message}`);
    this.code = code;
    this.status = status;
  }
}
export interface NetworkOptions {
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeout?: number;
  now?: () => number;
  readUnauthorizedBody?: boolean;
}
export async function request(
  url: string,
  init: RequestInit = {},
  options: NetworkOptions = {},
) {
  const fetcher = options.fetcher || fetch;
  const sleep =
    options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(options.timeout ?? 30000),
      });
    } catch (error) {
      if (attempt >= 3)
        throw new Error(`网络请求失败: ${new URL(url).hostname}`, {
          cause: error,
        });
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if (
      (response.status === 429 ||
        [500, 502, 503, 504].includes(response.status)) &&
      attempt < 3
    ) {
      const value = response.headers.get("retry-after");
      const delay = value
        ? Number.isFinite(Number(value))
          ? Number(value) * 1000
          : Math.max(0, Date.parse(value) - (options.now?.() ?? Date.now()))
        : 500 * 2 ** attempt;
      await response.body?.cancel();
      await sleep(delay);
      continue;
    }
    if (
      !response.ok &&
      response.status !== 304 &&
      !(options.readUnauthorizedBody && response.status === 401)
    ) {
      await response.body?.cancel();
      throw new HttpError(response.status);
    }
    return response;
  }
}
// Verified in the official public frontend; see docs/auth-refresh-evidence.json.
// The HTTP status is part of this classification, not only the business code.
export const invalidTokenCodes = new Set([10000]);
export class Api {
  #token = "";
  #refreshing?: Promise<void>;
  options: NetworkOptions;
  constructor(options: NetworkOptions = {}) {
    this.options = options;
  }
  async refresh() {
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = (async () => {
      const data = await this.#send("/web/v1/auth/refresh", "", "GET", "");
      if (!data.data?.token) throw Error("匿名令牌缺失");
      this.#token = data.data.token;
    })();
    try {
      await this.#refreshing;
    } finally {
      this.#refreshing = undefined;
    }
  }
  async #send(path: string, payload: string, method: string, token: string) {
    const r = await request(
      "https://zonai.skland.com" +
        path +
        (method === "GET" && payload ? "?" + payload : ""),
      {
        method,
        headers: signedHeaders(path, payload, token),
        ...(method === "POST" ? { body: payload } : {}),
      },
      { ...this.options, readUnauthorizedBody: true },
    );
    const d = await r.json();
    if (d.code !== 0)
      throw new BusinessError(
        d.code,
        String(d.message || d.msg || ""),
        r.status,
      );
    if (!r.ok) throw new HttpError(r.status);
    return d;
  }
  async get(path: string, query = "") {
    return this.call(path, query, "GET");
  }
  async post(path: string, body: unknown) {
    return this.call(path, JSON.stringify(body), "POST");
  }
  async call(path: string, payload: string, method: string) {
    if (!this.#token) await this.refresh();
    try {
      return await this.#send(path, payload, method, this.#token);
    } catch (e) {
      if (
        !(e instanceof BusinessError) ||
        e.status !== 401 ||
        !invalidTokenCodes.has(e.code)
      )
        throw e;
      await this.refresh();
      return this.#send(path, payload, method, this.#token);
    }
  }
}
