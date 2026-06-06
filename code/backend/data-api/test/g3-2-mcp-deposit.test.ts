/**
 * G3.2 — MCP equivalent of G3.1.
 *
 * Steps:
 *   1. MCP client tools/list → confirm action.entry_deposit is present.
 *   2. The MCP tools/call surface returns the route hint; this same
 *      intent lands through POST /v1/intents (same back-end path).
 *      We exercise the REST submission via the SDK so we can assert the
 *      returned tx hash, and verify the MCP catalog matches at the
 *      schema level.
 */
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { LendingSdk } from "../../../sdks/sdk-ts/src/index";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8787";
const API_KEY = process.env.API_KEY ?? "day11-local-test-api-key-please-rotate";

describe("G3.2 — MCP equivalent of G3.1", () => {
  it("tools/list advertises action.entry_deposit and the REST submit returns a tx hash", async () => {
    const sdk = new LendingSdk({ baseUrl: API_BASE_URL, apiKey: API_KEY });

    const tools = await sdk.mcp.toolsList();
    const names = (tools.tools ?? []).map((t) => t.name);
    expect(names).toContain("action.entry_deposit");

    const commitment = `0x${randomBytes(32).toString("hex")}`;
    const accepted = await sdk.intents.create(
      { kind: "entry_deposit", asset: "USDC", amount: "100000", commitment },
      { idempotencyKey: `g3-2-${randomBytes(8).toString("hex")}` },
    );
    const final = await sdk.intents.waitFor(accepted.intent_id);
    expect(final.status).toBe("confirmed");
    const job = final.jobs?.[0];
    expect(job?.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
  }, 60_000);
});
