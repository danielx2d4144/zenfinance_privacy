import { request } from "undici";
import { z } from "zod";
import { getConfig } from "../config.js";
import { log } from "../log.js";
import {
  KurierError,
  KurierRateLimited,
  KurierResponseShapeError,
  KurierVkNotRegistered,
} from "./errors.js";
import {
  JobStatusResponseSchema,
  RegisterVkRequestSchema,
  RegisterVkResponseSchema,
  SubmitProofRequestSchema,
  SubmitProofResponseSchema,
  type JobStatusResponse,
  type RegisterVkRequest,
  type RegisterVkResponse,
  type SubmitProofRequest,
  type SubmitProofResponse,
} from "./schemas.js";
import { defaultRetry, sleep, type RetryOptions } from "./retry.js";

export interface KurierClientOptions {
  baseUrl?: string;
  apiKey?: string;
  retry?: RetryOptions;
  fetchTimeoutMs?: number;
}

export class KurierClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly retry: RetryOptions;
  private readonly fetchTimeoutMs: number;

  constructor(opts: KurierClientOptions = {}) {
    const needEnv = opts.baseUrl === undefined || opts.apiKey === undefined;
    const env = needEnv ? getConfig() : null;
    this.baseUrl = (opts.baseUrl ?? env!.KURIER_BASE_URL).replace(/\/$/, "");
    this.apiKey = opts.apiKey ?? env!.KURIER_API_KEY;
    this.retry = opts.retry ?? defaultRetry;
    this.fetchTimeoutMs = opts.fetchTimeoutMs ?? 30_000;
  }

  async registerVk(req: RegisterVkRequest): Promise<RegisterVkResponse> {
    const body = RegisterVkRequestSchema.parse(req);
    return this.post(
      `/register-vk/${this.apiKey}`,
      body,
      RegisterVkResponseSchema,
      "register-vk",
    );
  }

  async submitProof(req: SubmitProofRequest): Promise<SubmitProofResponse> {
    const body = SubmitProofRequestSchema.parse(req);
    return this.post(
      `/submit-proof/${this.apiKey}`,
      body,
      SubmitProofResponseSchema,
      "submit-proof",
    );
  }

  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    return this.get(
      `/job-status/${this.apiKey}/${encodeURIComponent(jobId)}`,
      JobStatusResponseSchema,
      "job-status",
    );
  }

  private async post<S extends z.ZodTypeAny>(
    path: string,
    body: unknown,
    schema: S,
    label: string,
  ): Promise<z.infer<S>> {
    return this.callWithRetry(label, async () => {
      const res = await request(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        bodyTimeout: this.fetchTimeoutMs,
        headersTimeout: this.fetchTimeoutMs,
      });
      return this.parseResponse(res, schema, label);
    });
  }

  private async get<S extends z.ZodTypeAny>(
    path: string,
    schema: S,
    label: string,
  ): Promise<z.infer<S>> {
    return this.callWithRetry(label, async () => {
      const res = await request(`${this.baseUrl}${path}`, {
        method: "GET",
        bodyTimeout: this.fetchTimeoutMs,
        headersTimeout: this.fetchTimeoutMs,
      });
      return this.parseResponse(res, schema, label);
    });
  }

  private async parseResponse<S extends z.ZodTypeAny>(
    res: Awaited<ReturnType<typeof request>>,
    schema: S,
    label: string,
  ): Promise<z.infer<S>> {
    const status = res.statusCode;
    const text = await res.body.text();
    let json: unknown;
    try {
      json = text.length ? JSON.parse(text) : {};
    } catch {
      throw new KurierError(`${label}: non-JSON response (status ${status})`, status, text);
    }

    if (status === 429) {
      const retryAfterHeader = res.headers["retry-after"];
      const retryAfterSec = Array.isArray(retryAfterHeader)
        ? Number(retryAfterHeader[0])
        : Number(retryAfterHeader ?? "1");
      throw new KurierRateLimited(Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 1000, json);
    }

    if (status >= 400) {
      const msg = typeof json === "object" && json !== null && "message" in json
        ? String((json as Record<string, unknown>).message)
        : `HTTP ${status}`;
      if (/vk.*not.*registered/i.test(msg)) throw new KurierVkNotRegistered(json);
      throw new KurierError(`${label}: ${msg}`, status, json);
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new KurierResponseShapeError(label, issues, json);
    }
    return parsed.data;
  }

  private async callWithRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const delay = this.retryDelayFor(err, attempt);
        if (delay === null || attempt === this.retry.maxAttempts) break;
        log.warn({ label, attempt, delay, err: errToObj(err) }, "kurier-retry");
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  private retryDelayFor(err: unknown, attempt: number): number | null {
    if (err instanceof KurierRateLimited) return err.retryAfterMs;
    if (err instanceof KurierError) {
      if (err.status && err.status >= 500) return this.expBackoff(attempt);
      return null;
    }
    if (err instanceof KurierResponseShapeError) return null;
    return this.expBackoff(attempt);
  }

  private expBackoff(attempt: number): number {
    const exp = Math.min(this.retry.maxDelayMs, this.retry.baseDelayMs * 2 ** (attempt - 1));
    return this.retry.jitter ? Math.floor(Math.random() * exp) : exp;
  }
}

function errToObj(e: unknown): Record<string, unknown> {
  if (e instanceof Error) return { name: e.name, message: e.message };
  return { value: String(e) };
}
