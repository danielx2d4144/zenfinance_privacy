/**
 * Thin REST client. Other modules layer typed helpers on top of this.
 * Uses undici's fetch-compatible request so we get HTTP/2 + sane timeouts
 * without the global fetch's quirks under Node.
 */
import { request } from "undici";

export interface ClientOptions {
  /** Base URL up to and including the version segment, e.g. http://localhost:8787 */
  baseUrl: string;
  /** Required for /v1/intents endpoints (X-API-Key). Optional for public endpoints. */
  apiKey?: string;
  /** Per-request timeout in ms (default 30s). */
  timeoutMs?: number;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class Client {
  constructor(private readonly opts: ClientOptions) {
    if (!opts.baseUrl) throw new Error("baseUrl is required");
  }

  async json<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    init?: { body?: unknown; headers?: Record<string, string> },
  ): Promise<T> {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}${path}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(this.opts.apiKey ? { "x-api-key": this.opts.apiKey } : {}),
      ...(init?.headers ?? {}),
    };
    const res = await request(url, {
      method,
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      headersTimeout: this.opts.timeoutMs ?? 30_000,
      bodyTimeout: this.opts.timeoutMs ?? 30_000,
    });
    const text = await res.body.text();
    const status = res.statusCode;
    if (status < 200 || status >= 300) {
      let code = "HTTP_ERROR";
      let message = text.slice(0, 200);
      let details: unknown;
      try {
        const parsed = JSON.parse(text) as { code?: string; message?: string; details?: unknown };
        code = parsed.code ?? code;
        message = parsed.message ?? message;
        details = parsed.details;
      } catch {
        /* keep body verbatim */
      }
      throw new ApiError(status, code, message, details);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}
