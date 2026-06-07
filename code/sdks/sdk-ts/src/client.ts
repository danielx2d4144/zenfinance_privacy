/**
 * Thin REST client. Other modules layer typed helpers on top of this.
 * Uses the global `fetch` so the SDK works in both Node (>=18 has fetch
 * built-in; Node 22 is what data-api ships on) and the browser, which
 * means the same SDK package is shared by Day-12 examples and the
 * Day-13 dapp.
 */

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

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.opts.timeoutMs ?? 30_000,
    );
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text();
    if (!res.ok) {
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
      throw new ApiError(res.status, code, message, details);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}
