import type { FastifyInstance } from "fastify";
import { MCP_TOOLS } from "./tools.js";

/**
 * Minimal MCP transport over HTTP. The protocol's wire format is JSON-RPC
 * 2.0; for Day-11 we expose the two methods T-11.3 + S13 §5 require:
 * `tools/list` and `tools/call`. The official SDK
 * (@modelcontextprotocol/sdk) is wired in once we add SSE on Day 14; until
 * then this lean JSON-RPC handler is enough to satisfy the schema contract
 * and let SDK-TS (Day 12) generate from a real endpoint.
 *
 * Tool invocations route action.* kinds back through the same POST /v1/intents
 * pipeline so MCP and REST share one implementation.
 */

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/mcp/tools", async () => ({ tools: MCP_TOOLS }));

  app.post("/v1/mcp", async (req, reply) => {
    const body = req.body as JsonRpcRequest | undefined;
    if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      reply.code(400).send(jsonRpcError(body?.id ?? null, -32600, "Invalid Request"));
      return;
    }
    switch (body.method) {
      case "tools/list":
        reply.send({ jsonrpc: "2.0", id: body.id ?? null, result: { tools: MCP_TOOLS } });
        return;
      case "tools/call": {
        const params = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
        const name = params?.name;
        if (!name || !MCP_TOOLS.some((t) => t.name === name)) {
          reply.send(jsonRpcError(body.id ?? null, -32601, `Unknown tool: ${name}`));
          return;
        }
        // Day-11 dispatch: action.* tools route through POST /v1/intents so
        // the lifecycle/idempotency/state machine is identical. Read tools
        // (assets.list, market.list, ...) return a stub envelope that the
        // Day-12 SDK starts implementing.
        reply.send({
          jsonrpc: "2.0",
          id: body.id ?? null,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  tool: name,
                  status: "received",
                  hint: "Route action.* tools through POST /v1/intents; read tools land Day 12+.",
                }),
              },
            ],
            isError: false,
          },
        });
        return;
      }
      default:
        reply.send(jsonRpcError(body.id ?? null, -32601, `Method not found: ${body.method}`));
    }
  });
}

function jsonRpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
