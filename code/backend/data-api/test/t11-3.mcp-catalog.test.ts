/**
 * T-11.3 — MCP tools/list returns the full catalog and every intent kind
 * from S13 §6 appears as an `action.{kind}` tool with a schema.
 */
import { describe, expect, it } from "vitest";
import { MCP_TOOLS, INTENT_KINDS_IN_CATALOG } from "../src/mcp/tools";
import { AnyIntent } from "../src/intent/schemas";

describe("T-11.3 — MCP tool catalog", () => {
  it("advertises every intent kind from S13 §6 as an action.* tool", () => {
    // Extract the discriminator literals from AnyIntent (which is the
    // canonical source of "every intent kind").
    const optionLiterals: string[] = (AnyIntent as unknown as {
      options: { shape: { kind: { value: string } } }[];
    }).options.map((o) => o.shape.kind.value);

    for (const kind of optionLiterals) {
      expect(INTENT_KINDS_IN_CATALOG, `missing action.${kind}`).toContain(kind);
    }
    expect(INTENT_KINDS_IN_CATALOG.length).toBe(optionLiterals.length);
  });

  it("every tool has name + description + inputSchema (well-formed for tools/list)", () => {
    for (const t of MCP_TOOLS) {
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toBeTypeOf("object");
      expect((t.inputSchema as Record<string, unknown>).type).toBe("object");
    }
  });
});
