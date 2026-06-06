import type { Client } from "./client.js";
import type { paths } from "./generated/types.js";

export type McpToolsResponse = NonNullable<
  paths["/v1/mcp/tools"]["get"]["responses"]["200"]["content"]
>["application/json"];

export interface McpJsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

let nextId = 1;

export class McpClient {
  constructor(private readonly client: Client) {}

  /** Convenience HTTP view of tools/list. */
  async toolsHttp(): Promise<McpToolsResponse> {
    return this.client.json<McpToolsResponse>("GET", "/v1/mcp/tools");
  }

  /** JSON-RPC tools/list. */
  async toolsList(): Promise<McpToolsResponse> {
    const r = await this.client.json<McpJsonRpcResponse<McpToolsResponse>>("POST", "/v1/mcp", {
      body: { jsonrpc: "2.0", id: nextId++, method: "tools/list" },
    });
    if (r.error) throw new Error(`MCP tools/list error ${r.error.code}: ${r.error.message}`);
    if (!r.result) throw new Error("MCP tools/list returned no result");
    return r.result;
  }

  /** JSON-RPC tools/call dispatch. */
  async toolsCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    const r = await this.client.json<McpJsonRpcResponse>("POST", "/v1/mcp", {
      body: { jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } },
    });
    if (r.error) throw new Error(`MCP tools/call(${name}) error ${r.error.code}: ${r.error.message}`);
    return r.result;
  }
}
