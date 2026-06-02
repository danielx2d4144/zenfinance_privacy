# Subsystem 03 — Smart Accounts & Policy Engine

## 1. Purpose

The **agent-delegation layer**. Implements ERC-4337 smart accounts
(`AgentAccount`) plus an owner-signed `PolicyRegistry` that constrains what
an agent can do on behalf of its principal. This is what makes the protocol
**safe for AI agent use**.

Without this subsystem, a user wanting to delegate to an agent would have
to hand over their wallet's full private key. With this, the user grants
**bounded, revocable, auditable** authority — spending caps, time windows,
action whitelists, health-factor floors.

## 2. The model

```
Owner (EOA)
  │ signs Policy { agent_pubkey, spending_cap, hf_floor, expiry, ... }
  │ + funds AgentAccount
  ▼
AgentAccount (ERC-4337 smart wallet)
  │ owner = Owner
  │ session_keys = [agent_pubkey]
  │ policy_ref = id in PolicyRegistry
  ▼
Agent (LLM / bot)
  │ signs userOp with agent_pubkey
  │
  ▼  via ERC-4337 bundler  →  EntryPoint  →  AgentAccount.validateUserOp(...)
                                                  │ checks Policy
                                                  │ if pass, executes
                                                  ▼
                                            ShieldedSupplyPool / BorrowPool / etc.
```

## 3. Contracts

### `AgentAccount.sol` (ERC-4337 smart account)

```solidity
contract AgentAccount is BaseAccount {
    address public immutable owner;
    address public immutable entryPoint;

    // Each agent gets its own session key + policy
    struct Session {
        address agentPubkey;
        uint256 policyId;
        uint64  expiresAt;
        uint64  nonce;
        bool    revoked;
    }
    mapping(uint256 sessionId => Session) public sessions;

    function createSession(address agentPubkey, uint256 policyId,
                           uint64 expiresAt) external onlyOwner returns (uint256);
    function revokeSession(uint256 sessionId) external onlyOwner;

    function _validateSignature(UserOperation calldata userOp,
                                bytes32 userOpHash)
        internal override returns (uint256 validationData)
    {
        // Decode sessionId + signature from userOp.signature
        (uint256 sessionId, bytes memory sig) =
            abi.decode(userOp.signature, (uint256, bytes));
        Session storage s = sessions[sessionId];
        if (s.revoked || block.timestamp > s.expiresAt) return 1; // SIG_VALIDATION_FAILED

        address recovered = ECDSA.recover(userOpHash, sig);
        if (recovered != s.agentPubkey && recovered != owner) return 1;

        // Look up policy and validate the call
        Policy memory p = PolicyRegistry(policyRegistry).get(s.policyId);
        bool ok = _validateAgainstPolicy(userOp, p);
        if (!ok) return 1;

        return _packValidationData(0, s.expiresAt);
    }

    function _validateAgainstPolicy(UserOperation calldata userOp,
                                    Policy memory p)
        internal returns (bool);
}
```

### `PolicyRegistry.sol`

```solidity
struct AssetBudget {
    uint8   assetId;             // which asset this budget applies to
    uint128 capPerEpoch;         // max notional in this asset per epoch (in token units)
    uint16  hfFloorBps;          // applies when this asset is the debt; e.g., 20000 = HF ≥ 2.0
}

struct Policy {
    address owner;
    bytes32 nameHash;
    address[] allowedContracts;          // ShieldedSupplyPool, ShieldedPositionPool, LiquidationBoard, PrivacyEntry
    bytes4[]  allowedSelectors;          // function selectors per contract
    AssetBudget[] assetBudgets;          // per-asset spending caps + HF floors
    uint64    epochSeconds;
    uint16    globalHfFloorBps;          // overall position HF floor, regardless of asset
    uint64    expiresAt;
    bool      requireConfirmation;
}

mapping(uint256 policyId => Policy) public policies;
mapping(uint256 policyId => mapping(uint8 assetId => mapping(uint64 epoch => uint128))) public spending;
```

Owner signs an EIP-712 policy off-chain that **enumerates every asset
they're willing to let the agent touch**, with per-asset spending limits.
Calls `PolicyRegistry.register(policy, signature)` once.

### Policy enforcement checks

When `AgentAccount._validateAgainstPolicy(userOp, policy)` runs, it:

1. Parses `userOp.callData` to identify `(target, selector, assetId, args)`.
2. Checks `target ∈ allowedContracts` and `selector ∈ allowedSelectors`.
3. Looks up the budget entry for `assetId`. If no entry exists for that
   asset → reject. If exists → check `spending[policyId][assetId][currentEpoch]
   + value ≤ budget.capPerEpoch`.
4. For borrows specifically, the call data includes the new
   `liquidation_triggers` array. The contract requires that:
   - `currentPrice[assetId] / min_trigger ≥ assetBudgets[assetId].hfFloorBps / 10_000`, AND
   - the implied position HF ≥ `policy.globalHfFloorBps / 10_000`.
5. If `requireConfirmation`, requires a second signature from the owner.

## 4. Intent layer (above policy)

For ease of agent integration, an **intent translator** lives in the MCP
server (Subsystem 06). The agent says:

```json
{
  "intent": "BORROW",
  "asset": "USDC",
  "amount": 50000,
  "constraints": { "min_hf": 2.0 }
}
```

The intent translator:
1. Looks up the user's current borrower note (via subgraph).
2. Calculates the new commitment, new `liquidationPrice`.
3. Generates the borrow proof.
4. Builds the userOp with the right callData.
5. Submits via bundler.

The agent never has to think about Merkle paths or proof artifacts. It just
expresses intent.

## 5. External interfaces

### 5.1 For the owner (human, via dapp)

- `AgentAccount.createSession(agentPubkey, policyId, expiresAt)`
- `AgentAccount.revokeSession(sessionId)` — instant cutoff
- `PolicyRegistry.register(policy, ownerSignature)` — set up a policy once
- `PolicyRegistry.update(policyId, newPolicy, newSig)` — adjust later

### 5.2 For the agent (programmatic)

- `mcp.call("agent.getPolicy")` — fetch current policy state
- `mcp.call("agent.getRemainingSpending")` — how much left in current epoch
- `mcp.call("agent.submitIntent", {...})` — go!

### 5.3 ERC-4337 wiring

- **EntryPoint contract**: canonical `0x5FF1…0789` if Caldera deploys it on
  Horizen; otherwise we deploy our own (it's open-source, well-audited).
- **Bundler service**: we run one (small Go service that wraps a stock
  ERC-4337 bundler implementation). Free to use; agents can also use any
  public Horizen bundler if one exists.

## 6. Security & privacy

- **Owner is the only one who can mint sessions.** Agent cannot create new
  sessions for itself.
- **Session revocation is instant** — sets `revoked = true`; next userOp
  validation fails.
- **Policies are append-only / replaceable but not mutable mid-session.**
  Updating a policy creates a new policyId.
- **Spending cap uses a sliding window** to prevent burst exploitation.
- **HF floor is enforced at the policy layer**, not just by the contract —
  i.e., even if the underlying market changes parameters, the agent's
  authority stays bounded by what the owner originally agreed.
- **Privacy:** the AgentAccount is itself an on-chain entity, so its
  address is visible. But the **shielded-pool spending key** lives in the
  user's notes — the agent has to be granted access to those separately
  (encrypted to the agent's pubkey at delegation time).
- **No agent → owner privilege escalation.** Agents cannot change
  ownership, change policies, or grant other sessions.

## 7. Agent accessibility notes

This subsystem IS the agent accessibility layer for the entire protocol.
Every other subsystem benefits from this by being agent-agnostic at the
contract level — they don't have to know whether a caller is human or
agent, only that the userOp validates.

## 8. Dependencies

- ERC-4337 v0.7+ (`@account-abstraction/contracts`).
- OpenZeppelin `ECDSA`, `EIP712`.
- An ERC-4337 bundler (we run; eth-infinitism reference impl).
- For agent integrations: any LLM framework can drive this via the MCP
  server (Subsystem 06).

## 9. Diagram

```mermaid
sequenceDiagram
    actor OWNER as Owner (EOA)
    actor AGENT as Agent
    participant DAPP as Human dapp
    participant PR as PolicyRegistry
    participant AA as AgentAccount
    participant MCP as MCP server
    participant BUN as Bundler
    participant EP as EntryPoint
    participant POOLS as Pools / LiquidationBoard

    OWNER->>DAPP: "create agent session, policy: borrow up to $500k, HF floor 2.0, 30 days"
    OWNER->>PR: register(policy, EIP-712 sig)
    PR-->>OWNER: policyId
    OWNER->>AA: createSession(agentPubkey, policyId, expiresAt)
    AA-->>OWNER: sessionId

    Note over OWNER,AGENT: agent has agentPubkey + sessionId; uses MCP for everything

    AGENT->>MCP: submitIntent({BORROW, USDC, $50k, min_hf: 2.0})
    MCP->>MCP: build proof + userOp
    MCP->>BUN: submitUserOp(signed by agentPubkey)
    BUN->>EP: handleOps([userOp])
    EP->>AA: validateUserOp(...)
    AA->>PR: lookup(policyId)
    PR-->>AA: Policy
    AA->>AA: check selector, cap, HF floor
    AA-->>EP: validation OK
    EP->>AA: executeUserOp
    AA->>POOLS: borrow(nullifier, commitment, ...)
    POOLS-->>AGENT: tx success

    OWNER->>AA: revokeSession(sessionId) [if needed]
    Note over AA: future agent userOps fail validation
```
