/**
 * @lending/sdk-ts — TypeScript SDK for the Day-11 REST API.
 *
 * Types are generated from the same openapi.json the API server emits;
 * mutating the server's zod schemas regenerates the SDK types, so the
 * surface stays in sync without manual editing (T-12.3).
 */
export { Client, ApiError, type ClientOptions } from "./client.js";
export { IntentsApi, TERMINAL_STATUSES, type AnyIntentInput, type IntentAccepted, type IntentDetail, type IntentStatus } from "./intents.js";
export { McpClient, type McpToolsResponse, type McpJsonRpcResponse } from "./mcp.js";

import { Client, type ClientOptions } from "./client.js";
import { IntentsApi } from "./intents.js";
import { McpClient } from "./mcp.js";

/**
 * One-shot factory. `new LendingSdk({...}).intents.create(...)` is the
 * shortest path for callers who don't care about wiring sub-clients.
 */
export class LendingSdk {
  readonly client: Client;
  readonly intents: IntentsApi;
  readonly mcp: McpClient;

  constructor(opts: ClientOptions) {
    this.client = new Client(opts);
    this.intents = new IntentsApi(this.client);
    this.mcp = new McpClient(this.client);
  }
}
