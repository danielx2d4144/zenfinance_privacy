/**
 * T-11.4 — OpenAPI 3.1 spec lints clean.
 *
 * Uses spectral programmatically (not the CLI) so the test self-contains:
 * the assertion is "0 errors, 0 warnings against the canonical OpenAPI
 * ruleset".
 */
import { describe, expect, it } from "vitest";
import { Spectral } from "@stoplight/spectral-core";
import * as spectralRulesets from "@stoplight/spectral-rulesets";
import { buildOpenApiSpec } from "../src/openapi";

describe("T-11.4 — OpenAPI 3.1 lints clean", () => {
  it("spectral oas ruleset returns 0 errors and 0 warnings", async () => {
    const spectral = new Spectral();
    // The canonical OpenAPI ruleset from @stoplight/spectral-rulesets.
    // CommonJS interop: `oas` is the exported ruleset object.
    spectral.setRuleset((spectralRulesets as unknown as { oas: { rules: Record<string, unknown> } }).oas);
    const spec = buildOpenApiSpec();
    const results = await spectral.run(JSON.stringify(spec));

    // Severity codes: 0=error, 1=warn, 2=info, 3=hint.
    const errors = results.filter((r) => r.severity === 0);
    const warnings = results.filter((r) => r.severity === 1);

    if (errors.length || warnings.length) {
      // eslint-disable-next-line no-console
      console.error(
        results.map((r) => `${r.severity === 0 ? "ERROR" : "WARN"} ${r.code} @ ${r.path.join(".")}: ${r.message}`).join("\n"),
      );
    }
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
