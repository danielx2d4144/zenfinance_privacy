# Subsystem 07 — Human Frontend (Next.js Dapp)

## 1. Purpose

The web app human users see: connect wallet → deposit → borrow → repay →
liquidate. Visually communicates a private protocol's state ("your position
is private, but here are the public market metrics") and walks users
through proof generation in the browser.

Per Q3.11 v1 resolution: **minimal scope** in v1 — the 4 core flows + a
positions view + agent-delegation UI for those who want it.

## 2. Project layout

```
apps/web/
├── package.json
├── next.config.mjs
├── .env.local
├── src/
│   ├── pages/
│   │   ├── index.tsx                 # markets overview (one card per (asset, side))
│   │   ├── markets/[asset].tsx       # per-asset market details (rate curve, history)
│   │   ├── positions.tsx             # the user's multi-asset positions
│   │   ├── agent.tsx                 # delegate to an AI agent (with per-asset policy)
│   │   ├── liquidate.tsx             # power-user liquidator UI (asset selectors)
│   │   ├── solvency.tsx              # per-asset InsuranceFund + deficit transparency
│   │   └── api/*                      # Next.js API routes (Kurier proxy, etc.)
│   ├── components/
│   │   ├── ConnectWallet.tsx
│   │   ├── AssetSelector.tsx         # picks from enabled assets (USDC, cbBTC, [WETH, ZEN])
│   │   ├── MarketCard.tsx            # one per asset; supply rate + borrow rate
│   │   ├── PositionTable.tsx         # multi-row: per-asset collateral, per-asset debt, HF
│   │   ├── DepositForm.tsx           # asset-parameterized: pick asset, encrypt, prove
│   │   ├── BorrowForm.tsx            # asset-parameterized; debtAsset selector
│   │   ├── RepayForm.tsx             # asset-parameterized
│   │   ├── WithdrawForm.tsx          # asset-parameterized (supply or collateral)
│   │   ├── HealthFactorBar.tsx       # multi-asset HF visualization
│   │   ├── LiquidationPicker.tsx     # asset-aware: pick collateralAsset + debtAsset
│   │   ├── ProofProgressModal.tsx    # shows ~3-5 min aggregation wait
│   │   ├── AgentDelegationWizard.tsx # per-asset spending caps, per-asset HF floors
│   │   └── AuditorOptInToggle.tsx
│   ├── lib/
│   │   ├── prover.ts                 # @aztec/bb.js wrapper; circuit-kind dispatcher
│   │   ├── notes.ts                  # multi-asset note storage (per-(asset, kind))
│   │   ├── spending-key.ts           # derive from wallet via HKDF
│   │   ├── subgraph.ts               # GraphQL client to Goldsky
│   │   ├── rest.ts                   # REST client to backend
│   │   ├── health-factor.ts          # multi-asset HF compute from decrypted position
│   │   ├── triggers.ts               # per-asset trigger derivation (mirror of circuit)
│   │   ├── assets.ts                 # asset registry from chain
│   │   └── account.ts                # ERC-4337 helpers
│   └── styles/
```

## 3. Key flows in the UI

### 3.1 First-time deposit

1. **Connect wallet** (MetaMask, SubWallet, Talisman). Network switched to
   Horizen automatically.
2. **Sign challenge** to derive the spending key. One-time signature; key
   is held only in memory; can be re-derived any time.
3. **Approve USDC permit** in-modal.
4. **Click Deposit**. The dapp:
   - Builds the deposit note client-side.
   - Encrypts the note to the user's wallet pubkey + saves it to
     `localStorage` (and optionally pushes a backup to our note service).
   - Generates the ZK proof in browser (~5 s).
   - Submits to backend `/api/proofs` (which forwards to Kurier).
   - Shows `ProofProgressModal` with a progress bar over the expected
     3-5 min aggregation wait.
5. **Wait → aggregated → on-chain tx auto-submitted.** Modal updates to
   "Confirmed" with a link to the Horizen explorer.
6. **Position renders** in `/positions` showing the user's supply.

### 3.2 Health factor display

Every borrow position renders a `HealthFactorBar`:

```
 1.00 │ liquidation
       │
 1.20 ├──────────  ← "PositionAtRisk" zone (yellow)
       │
 1.50 │
       │
 2.00 ├──────────  ← agent policy floor (if delegated)
       │
       │  your position: HF = 1.83  ●
 4.00 │
```

The HF is computed locally from the decrypted note + current Stork price
(both available client-side). **Not** from the subgraph — that would
require revealing positions to the indexer.

### 3.3 Agent delegation wizard

A dedicated `/agent` page:

1. **Step 1**: paste an agent's pubkey (or generate one for your own
   self-hosted bot).
2. **Step 2**: build a policy with sliders + checkboxes:
   - Spending cap per epoch (slider).
   - HF floor (slider, default 2.0).
   - Expiry (date picker).
   - Allowed actions (checkboxes: deposit, borrow, repay, withdraw,
     liquidate).
3. **Step 3**: review + sign the EIP-712 policy.
4. **Step 4**: deploy `AgentAccount` if not yet existing; create session.
5. **Step 5**: get a pasteable bundle (agent pubkey + sessionId + MCP
   endpoint) the user gives to their agent's config.

Inline: a "Test the agent" button that lets the user verify with a small
non-committal call.

### 3.4 Proof progress modal

Critical UX element. Shows:
- The proof has been generated locally (~5 s — already done by this point).
- Submitted to Kurier (job ID + Kurier-status indicator).
- Aggregating (with a smoothed progress bar based on observed aggregation
  cadence; usually 2-4 min).
- Posted to Horizen.
- Tx confirmed.

If anything fails: clear error message + "retry" or "save proof to retry
later" option.

### 3.5 Note management UX

- A small "Notes" indicator in the navbar shows how many notes the user
  has stored locally + last backup time.
- Manual "Backup notes" button → encrypted blob uploaded to our note-backup
  service (or IPFS, user's choice).
- "Restore from seed phrase" flow re-derives the spending key and scans the
  subgraph for the user's commitments (any commitment created with this
  spending key is theirs to claim — they reconstruct notes from the
  on-chain commitment + locally-derived secret).

## 4. State model (in-memory + localStorage)

```ts
type AppState = {
  wallet: { address: `0x${string}`; isHorizen: boolean };
  spendingKey: Uint8Array | null;        // in-memory only

  notes: {
    supply: SupplyNote[];                // each encrypted before persisting
    borrow: BorrowNote[];                // each encrypted before persisting
  };

  markets: Record<string, MarketData>;   // from subgraph
  oraclePrices: Record<string, { price: bigint; ts: number }>;

  agentAccount: {
    address: `0x${string}` | null;       // user's ERC-4337 wallet
    sessions: Session[];
  };

  pendingProofs: Array<{
    intentId: string;
    kind: CircuitKind;
    status: "proving" | "submitted" | "aggregating" | "confirmed" | "failed";
    jobId?: string;
  }>;

  notifications: AppNotification[];      // PositionAtRisk, etc.
};
```

## 5. Security & privacy notes

- **Spending key in memory only.** Re-derived on every page load.
- **Notes encrypted with the wallet's pubkey** before any storage.
  Decrypted only when displayed.
- **No tracking, no analytics by default.** Optional anonymous Plausible
  for ops metrics.
- **CSP + SRI** on all bundled scripts; pinned dependency versions; SBOM
  exported.
- **Connect-wallet stays read-only** until the user explicitly clicks a
  state-changing button. Wallet popups carry full unsigned-payload preview.
- **No Kurier API key in the browser.** All Kurier traffic is proxied
  through `/api/*` (server-side).

## 6. Agent accessibility notes

This subsystem is the **human-facing** entry point. The agent-facing
equivalent is the MCP server in Subsystem 06. The two share:
- The same backend (Postgres jobs, Kurier proxy).
- The same prover library (`@aztec/bb.js`), though humans run it in
  browser WASM while agents run it server-side.
- The same `AgentAccount` semantics — the dapp lets humans create+manage
  the same kind of account agents use.

The dapp **also** can act as an agent client: power users who want to run
a personal liquidator bot can paste the MCP server URL into a "Liquidator"
panel and let the dapp run a simple watcher in the background tab.

## 7. Dependencies

- Next.js 14+.
- ethers v6.
- `@aztec/bb.js` for client-side proving.
- `@account-abstraction/sdk` for userOp construction.
- Subgraph + REST API URLs (Subsystem 06).
- Goldsky subgraph (read-only).

## 8. Diagram

```mermaid
flowchart TB
  USER[Human user]
  WAL[MetaMask / SubWallet]

  subgraph Browser
    UI[Next.js dapp]
    PROVER[bb.js WASM prover]
    SPK[Spending-key derivation]
    LSTORE[localStorage<br/>encrypted notes]
  end

  subgraph Backend (Next.js API routes)
    APIPROXY["/api/proofs<br/>(Kurier proxy)"]
    APIREST["/api/rest<br/>(REST passthrough w/ key)"]
  end

  subgraph External
    KUR[Kurier]
    RESTAPI[REST API<br/>subsystem 06]
    SUBGRAPH[Goldsky subgraph]
    HORIZEN[Horizen RPC]
  end

  USER --> WAL
  USER --> UI
  WAL --> UI
  UI --> PROVER
  UI --> SPK
  UI --> LSTORE

  UI -- "submit proof" --> APIPROXY
  APIPROXY --> KUR
  UI -- "queries" --> APIREST
  APIREST --> RESTAPI
  UI -- "direct read" --> SUBGRAPH
  UI -- "send tx via wallet" --> HORIZEN
```
