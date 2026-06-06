/**
 * MCP tool catalog — the verbatim list S13 §5 commits to. T-11.3 requires
 * every intent kind from S13 §6 to appear here as a `action.{kind}` tool.
 *
 * Keep the JSON Schemas minimal but typed; the dapp + the LLM both rely
 * on these for input validation.
 */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const ASSET_ENUM = ["USDC", "cbBTC", "WETH", "ZEN"];
const AMOUNT = { type: "string", pattern: "^\\d+$", description: "uint256 as a decimal string" };
const ADDRESS = { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" };
const BYTES32 = { type: "string", pattern: "^0x[a-fA-F0-9]{64}$" };

export const MCP_TOOLS: ToolDescriptor[] = [
  // ── Discovery (no auth) ────────────────────────────────────────────────
  {
    name: "assets.list",
    description: "List all assets enabled on the protocol.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "market.list",
    description: "Per-asset market metrics: rates, utilization, total supply/borrow.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "market.get",
    description: "Detailed view of one asset's market state.",
    inputSchema: {
      type: "object",
      required: ["asset"],
      properties: { asset: { type: "string", enum: ASSET_ENUM } },
    },
  },
  {
    name: "oracle.price",
    description: "Current Stork-fed price for an asset, in USD.",
    inputSchema: {
      type: "object",
      required: ["asset"],
      properties: { asset: { type: "string", enum: ASSET_ENUM } },
    },
  },
  {
    name: "liquidations.scan",
    description: "List positions currently liquidatable. Optional asset filters.",
    inputSchema: {
      type: "object",
      properties: {
        collateralAsset: { type: "string", enum: ASSET_ENUM },
        debtAsset: { type: "string", enum: ASSET_ENUM },
        minProfitUSD: { type: "number" },
      },
    },
  },

  // ── Position read (session required) ──────────────────────────────────
  {
    name: "position.list",
    description: "All multi-asset positions for an AgentAccount's owner.",
    inputSchema: {
      type: "object",
      required: ["ownerAddress"],
      properties: { ownerAddress: ADDRESS },
    },
  },
  {
    name: "position.previewAction",
    description: "Compute the resulting HF, triggers, and balance changes WITHOUT submitting.",
    inputSchema: {
      type: "object",
      required: ["actionKind", "asset", "amount"],
      properties: {
        actionKind: {
          type: "string",
          enum: [
            "SUPPLY",
            "WITHDRAW_SUPPLY",
            "DEPOSIT_COLLATERAL",
            "WITHDRAW_COLLATERAL",
            "BORROW",
            "REPAY",
          ],
        },
        asset: { type: "string", enum: ASSET_ENUM },
        amount: AMOUNT,
      },
    },
  },

  // ── Action tools (session required; idempotent) ───────────────────────
  {
    name: "action.entry_deposit",
    description: "Move ERC-20 into PrivacyEntry custody, inserting a balance commitment.",
    inputSchema: {
      type: "object",
      required: ["asset", "amount", "commitment"],
      properties: { asset: { type: "string", enum: ASSET_ENUM }, amount: AMOUNT, commitment: BYTES32 },
    },
  },
  {
    name: "action.entry_withdraw",
    description: "Withdraw an asset from PrivacyEntry back to an external address.",
    inputSchema: {
      type: "object",
      required: ["asset", "amount", "recipient"],
      properties: { asset: { type: "string", enum: ASSET_ENUM }, amount: AMOUNT, recipient: ADDRESS },
    },
  },
  {
    name: "action.supply",
    description: "Supply asset from PrivacyEntry balance into the supply pool.",
    inputSchema: {
      type: "object",
      required: ["asset", "amount"],
      properties: { asset: { type: "string", enum: ASSET_ENUM }, amount: AMOUNT },
    },
  },
  {
    name: "action.withdraw_supply",
    description: "Withdraw a supplied position back to PrivacyEntry balance.",
    inputSchema: {
      type: "object",
      required: ["asset", "amount"],
      properties: { asset: { type: "string", enum: ASSET_ENUM }, amount: AMOUNT },
    },
  },
  {
    name: "action.deposit_collateral",
    description: "Move an asset from PrivacyEntry balance into the position pool as collateral.",
    inputSchema: {
      type: "object",
      required: ["asset", "amount"],
      properties: { asset: { type: "string", enum: ASSET_ENUM }, amount: AMOUNT },
    },
  },
  {
    name: "action.withdraw_collateral",
    description: "Withdraw collateral subject to the position's HF floor.",
    inputSchema: {
      type: "object",
      required: ["asset", "amount"],
      properties: {
        asset: { type: "string", enum: ASSET_ENUM },
        amount: AMOUNT,
        minHfBps: { type: "integer", minimum: 0, maximum: 100000 },
      },
    },
  },
  {
    name: "action.borrow",
    description: "Borrow against the position; respects the policy HF floor.",
    inputSchema: {
      type: "object",
      required: ["asset", "amount"],
      properties: {
        asset: { type: "string", enum: ASSET_ENUM },
        amount: AMOUNT,
        minHfBps: { type: "integer", minimum: 0, maximum: 100000 },
      },
    },
  },
  {
    name: "action.repay",
    description: "Repay debt for the named asset.",
    inputSchema: {
      type: "object",
      required: ["asset", "amount"],
      properties: { asset: { type: "string", enum: ASSET_ENUM }, amount: AMOUNT },
    },
  },
  {
    name: "action.liquidate",
    description: "Liquidate an unhealthy position; seize collateral, cover debt.",
    inputSchema: {
      type: "object",
      required: ["targetCommitment", "collateralAsset", "debtAsset", "debtToCover"],
      properties: {
        targetCommitment: BYTES32,
        collateralAsset: { type: "string", enum: ASSET_ENUM },
        debtAsset: { type: "string", enum: ASSET_ENUM },
        debtToCover: AMOUNT,
      },
    },
  },
  {
    name: "action.consolidate_balance",
    description: "Merge fragmented PrivacyEntry balance notes for `asset` into one.",
    inputSchema: {
      type: "object",
      required: ["asset"],
      properties: { asset: { type: "string", enum: ASSET_ENUM } },
    },
  },

  // ── Intent observability ─────────────────────────────────────────────
  {
    name: "intent.status",
    description: "Look up the status of an intent by its id.",
    inputSchema: {
      type: "object",
      required: ["intentId"],
      properties: { intentId: { type: "string", format: "uuid" } },
    },
  },
];

/** All `action.*` intent kinds (S13 §6) — used by T-11.3 catalog check. */
export const INTENT_KINDS_IN_CATALOG = MCP_TOOLS
  .filter((t) => t.name.startsWith("action."))
  .map((t) => t.name.slice("action.".length));
