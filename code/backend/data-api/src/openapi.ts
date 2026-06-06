import { zodToJsonSchema } from "zod-to-json-schema";
import { AnyIntent } from "./intent/schemas.js";

/**
 * Build a self-contained OpenAPI 3.1 document covering the Day-11 surface.
 * Spectral lints this; SDK-TS (T-12.1) is generated from it.
 *
 * We hand-build the structure rather than relying on a Fastify swagger
 * plugin's auto-extraction because the OpenAPI shape S13 §4 mandates is
 * specific (response refs, error envelopes, idempotency headers).
 */
function intentSchema(_name: string, zodSchema: Parameters<typeof zodToJsonSchema>[0]) {
  // Inline the JSON Schema entirely: no $ref, no definitions block. This
  // keeps the OpenAPI document self-contained so spectral never traverses
  // a cross-reference into a stale path. (We could rewire refs to land
  // under #/components/schemas/, but inlining is simpler and the SDK
  // generator handles either form fine.)
  const raw = zodToJsonSchema(zodSchema, { target: "openApi3", $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete raw["$schema"];
  delete raw["definitions"];
  return raw;
}

export function buildOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Privacy Lending Protocol API",
      version: "0.2.0",
      description:
        "Day-11 surface: REST + MCP endpoints for the zenfinance privacy lending protocol. See design-v2/subsystems/13_api_contract.md for the canonical contract.",
      contact: { name: "zenfinance", url: "https://example.invalid" },
      license: { name: "UNLICENSED", url: "https://example.invalid" },
    },
    servers: [
      { url: "http://localhost:8787", description: "Local Day-11 dev" },
    ],
    tags: [
      { name: "health", description: "Liveness probe" },
      { name: "intents", description: "Action intents — submit + poll" },
      { name: "mcp", description: "MCP server (tools/list, tools/call)" },
    ],
    components: {
      securitySchemes: {
        apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
      schemas: {
        AnyIntent: intentSchema("AnyIntent", AnyIntent),
        IntentAccepted: {
          type: "object",
          required: ["intent_id", "status"],
          properties: {
            intent_id: { type: "string", format: "uuid" },
            status: {
              type: "string",
              enum: [
                "received",
                "proving",
                "submitted",
                "aggregated",
                "userop_pending",
                "confirmed",
                "failed",
              ],
            },
            failure_reason: { type: "string", nullable: true },
          },
        },
        IntentDetail: {
          allOf: [
            { $ref: "#/components/schemas/IntentAccepted" },
            {
              type: "object",
              required: ["created_at", "updated_at"],
              properties: {
                created_at: { type: "string", format: "date-time" },
                updated_at: { type: "string", format: "date-time" },
                jobs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      tx_hash: { type: "string", nullable: true },
                      status_payload: {},
                      created_at: { type: "string", format: "date-time" },
                      updated_at: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          ],
        },
        ErrorEnvelope: {
          type: "object",
          required: ["code", "message", "retryable"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            retryable: { type: "boolean" },
            details: {},
          },
        },
      },
    },
    paths: {
      "/v1/health": {
        get: {
          tags: ["health"],
          summary: "Liveness probe",
          description: "Returns the protocol's data-api version + day marker. Used by load balancers and the dapp to detect availability.",
          operationId: "getHealth",
          responses: {
            "200": {
              description: "Service is up",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status"],
                    properties: {
                      status: { type: "string", enum: ["ok"] },
                      version: { type: "string" },
                      day: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/intents": {
        post: {
          tags: ["intents"],
          summary: "Submit a new action intent",
          description: "Submit an intent describing one of the protocol's actions (deposit, withdraw, supply, borrow, ...). Returns 202 with a UUID intent_id; clients poll GET /v1/intents/{id} for status. Honours the Idempotency-Key header (T-11.2 contract).",
          operationId: "createIntent",
          security: [{ apiKeyAuth: [] }],
          parameters: [
            {
              in: "header",
              name: "Idempotency-Key",
              required: false,
              schema: { type: "string", maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" },
              description:
                "Client-chosen key. Replays return the cached response with the same intent_id (T-11.2 contract).",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AnyIntent" },
              },
            },
          },
          responses: {
            "202": {
              description: "Intent accepted; processing started",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntentAccepted" },
                },
              },
            },
            "400": {
              description: "Validation error",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } },
              },
            },
            "401": {
              description: "Missing or invalid API key",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } },
              },
            },
          },
        },
      },
      "/v1/intents/{id}": {
        get: {
          tags: ["intents"],
          summary: "Poll an intent's status",
          description: "Returns the current status of an intent plus its job rows (tx hashes, status payloads). Status transitions through the S13 §3 state machine: received → proving → submitted → ... → confirmed (or failed).",
          operationId: "getIntent",
          security: [{ apiKeyAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              description: "Intent state",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IntentDetail" },
                },
              },
            },
            "404": {
              description: "Intent not found",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } },
              },
            },
          },
        },
      },
      "/v1/mcp/tools": {
        get: {
          tags: ["mcp"],
          summary: "List MCP tools (convenience HTTP view of tools/list)",
          description: "Returns the same tool catalog the JSON-RPC tools/list method serves. Useful for browsers, curl, and SDK introspection that doesn't want to wrap JSON-RPC envelopes.",
          operationId: "listMcpTools",
          responses: {
            "200": {
              description: "Tool catalog",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["tools"],
                    properties: {
                      tools: {
                        type: "array",
                        items: {
                          type: "object",
                          required: ["name", "description", "inputSchema"],
                          properties: {
                            name: { type: "string" },
                            description: { type: "string" },
                            inputSchema: {},
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/mcp": {
        post: {
          tags: ["mcp"],
          summary: "MCP JSON-RPC entrypoint (methods: tools/list, tools/call)",
          description: "JSON-RPC 2.0 endpoint implementing the Model Context Protocol's tools surface. tools/call dispatches action.* tools through the same POST /v1/intents pipeline so the lifecycle is identical between REST and MCP clients.",
          operationId: "mcpJsonRpc",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["jsonrpc", "method"],
                  properties: {
                    jsonrpc: { type: "string", enum: ["2.0"] },
                    id: { type: ["string", "number", "null"] },
                    method: { type: "string" },
                    params: {},
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "JSON-RPC response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["jsonrpc"],
                    properties: {
                      jsonrpc: { type: "string", enum: ["2.0"] },
                      id: { type: ["string", "number", "null"] },
                      result: {},
                      error: { type: "object" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  } as const;
}
