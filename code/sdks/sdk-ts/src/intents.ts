import type { Client } from "./client.js";
import type { components, paths } from "./generated/types.js";

/**
 * Helpers around POST /v1/intents and GET /v1/intents/{id}. The request /
 * response types are pulled from the OpenAPI-generated `components` so
 * adding a field to the server's zod schemas automatically tightens the
 * SDK signatures (T-12.3 derivation chain).
 */

export type AnyIntentInput = NonNullable<
  paths["/v1/intents"]["post"]["requestBody"]
>["content"]["application/json"];

export type IntentAccepted = components["schemas"]["IntentAccepted"];
export type IntentDetail = components["schemas"]["IntentDetail"];
export type IntentStatus = NonNullable<IntentAccepted["status"]>;

export const TERMINAL_STATUSES: readonly IntentStatus[] = ["confirmed", "failed"] as const;

export class IntentsApi {
  constructor(private readonly client: Client) {}

  async create(body: AnyIntentInput, opts?: { idempotencyKey?: string }): Promise<IntentAccepted> {
    return this.client.json<IntentAccepted>("POST", "/v1/intents", {
      body,
      headers: opts?.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : undefined,
    });
  }

  async get(intentId: string): Promise<IntentDetail> {
    return this.client.json<IntentDetail>("GET", `/v1/intents/${intentId}`);
  }

  /** Poll until the intent reaches a terminal status. Returns the final row. */
  async waitFor(
    intentId: string,
    opts?: { deadlineMs?: number; pollMs?: number },
  ): Promise<IntentDetail> {
    const deadline = Date.now() + (opts?.deadlineMs ?? 60_000);
    const pollMs = opts?.pollMs ?? 250;
    while (Date.now() < deadline) {
      const row = await this.get(intentId);
      if (row.status && TERMINAL_STATUSES.includes(row.status as IntentStatus)) return row;
      await new Promise((res) => setTimeout(res, pollMs));
    }
    throw new Error(`intent ${intentId} did not reach a terminal state in time`);
  }
}
