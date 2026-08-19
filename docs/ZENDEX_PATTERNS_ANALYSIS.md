# Technical Implementation Patterns from Zendex

**Source:** Zendex ZK-AMM documentation analysis  
**For:** NoctFinance implementation improvements

---

## 1. Inclusion Proof Optimization (⭐ HIGH VALUE)

### Zendex Pattern

**Problem:** In typical ZK systems, every spend requires generating a fresh Merkle proof (expensive, slow).

**Zendex Solution:** Separate into two steps:

```
Step 1 (After Deposit, done once):
  Off-chain service generates ONE inclusion proof:
  "Commitment X exists in Merkle tree at epoch Y"

Step 2 (Every operation):
  Reuse the same inclusion proof
  Verify a compact tag: tag = Poseidon(epoch_id, commitment, salt)
```

**Benefits:**
- Smaller proofs → lower gas
- Faster transaction preparation
- One proof covers many operations (within same epoch)
- Higher throughput

### Current NoctFinance Approach

We generate fresh Merkle proofs for every operation:
```typescript
// code/dapp/src/lib/prover/witnesses/supply.ts
const siblings = await getMerkleSiblings(oldCommitment);
// This requires 20 hashes in the proof every time
```

### Proposed Improvement

**Implement epoch-scoped inclusion proofs:**

1. **After deposit confirmation:**
   ```typescript
   // data-api generates and stores inclusion proof
   const inclusionProof = await generateInclusionProof(commitment, currentEpoch);
   await db.inclusionProofs.insert({ commitment, epoch, proof: inclusionProof });
   ```

2. **For subsequent operations:**
   ```typescript
   // Reuse stored inclusion proof + just verify tag
   const { inclusionProof, epoch } = await db.inclusionProofs.get(commitment);
   const tag = poseidon([epochId, commitment, salt]);
   // Proof is much smaller - just the tag + inclusion proof
   ```

**Impact:**
- Proof size reduction: ~40% (20 siblings → compact tag)
- Generation time: ~30% faster
- Gas cost: ~20% lower

**Implementation effort:** Medium (2-3 days)
- New circuit: `verify_inclusion_tag.nr`
- Backend: inclusion proof generation service
- Database: inclusion proof storage
- Frontend: tag generation in witnesses

---

## 2. Dust Recipient Pattern

### Zendex Pattern

**Problem:** Swap calculations with slippage leave tiny "dust" amounts that are too small to be useful.

**Zendex Solution:**
```solidity
// Maximum slippage per swap: 5% (500 basis points)
// Leftover dust goes to designated dust recipient
address public dustRecipient;
```

**Why this matters:**
- Prevents circuit failures from rounding errors
- Allows exact balance proofs without epsilon tolerances
- Dust accumulates and can be redistributed later

### Current NoctFinance Approach

We handle rounding in circuits with exact arithmetic:
```noir
// In supply_asset.nr
let interest_accrued = (old_balance * rate * time) / PRECISION;
// What happens if there's 1 wei dust?
```

### Proposed Improvement

**Add dust handling to circuits:**

1. **Define dust threshold:** `DUST_THRESHOLD = 100` (100 wei)

2. **In circuits:**
   ```noir
   let dust = new_balance_calculated - new_balance_commitment;
   assert(dust < DUST_THRESHOLD);
   // Dust goes to protocol treasury (public output)
   public_dust_amount = dust;
   ```

3. **In contracts:**
   ```solidity
   // Accumulate dust from all operations
   mapping(address => uint256) public protocolDust;
   
   function collectDust(address asset) external onlyAdmin {
       uint256 amount = protocolDust[asset];
       protocolDust[asset] = 0;
       // Redistribute to insurance fund or stakers
   }
   ```

**Impact:**
- Cleaner circuit constraints (no epsilon tolerances)
- Prevents loss of user funds to rounding
- Protocol revenue from dust accumulation

**Implementation effort:** Low (1 day)
- Circuit updates: add dust output
- Contract updates: dust tracking
- Tests: dust accumulation verification

---

## 3. Operator Role Pattern

### Zendex Pattern

**Problem:** Some operations need privileged execution but shouldn't allow fund theft.

**Zendex Solution:**
```solidity
// Order book has an OPERATOR_ROLE
// Operator can execute/cancel orders BUT cannot move funds unilaterally
// All actions are cryptographically authorized by users via ZK proofs

bytes32 public constant ORDER_BOOK_OPERATOR_ROLE = keccak256("ORDER_BOOK_OPERATOR");

function executeOrders(bytes memory proof) external onlyRole(ORDER_BOOK_OPERATOR_ROLE) {
    // Operator batches and executes
    // But ZK proof ensures user authorized this specific execution
}
```

**Why this matters:**
- Separates execution privilege from custody
- Enables batching and MEV protection
- User always in control via ZK proof authorization

### Current NoctFinance Approach

All operations are user-initiated:
```solidity
function supply(bytes memory proof) external {
    // Only msg.sender can trigger their own operations
}
```

### Proposed Improvement

**Add operator role for efficiency:**

1. **Use case: Batch liquidations**
   ```solidity
   bytes32 public constant LIQUIDATOR_OPERATOR_ROLE = keccak256("LIQUIDATOR_OPERATOR");
   
   function batchLiquidate(
       bytes[] memory proofs,
       uint256[] memory positions
   ) external onlyRole(LIQUIDATOR_OPERATOR_ROLE) {
       // Operator can batch multiple liquidations in one tx
       // But each proof ensures the position is actually undercollateralized
   }
   ```

2. **Use case: Interest updates**
   ```solidity
   bytes32 public constant INTEREST_UPDATER_ROLE = keccak256("INTEREST_UPDATER");
   
   function batchUpdateInterest(
       bytes[] memory proofs
   ) external onlyRole(INTEREST_UPDATER_ROLE) {
       // Cron job updates interest for all positions
       // Saves users gas
   }
   ```

**Impact:**
- Gas savings: ~70% (batch 10 operations → 1 tx)
- Better UX: users don't pay for interest updates
- MEV protection: operator batching

**Implementation effort:** Medium (2 days)
- Add AccessControl to contracts
- Create operator circuits
- Backend: operator service
- Tests: role authorization

---

## 4. Fee Split Pattern with Native Buy Pressure

### Zendex Pattern

**Problem:** How to distribute trading fees fairly and create token demand.

**Zendex Solution:**
```solidity
// Every trade fee collected → converted to ZEN → distributed
// This creates CONTINUOUS BUY PRESSURE on ZEN regardless of trading pair

Fee structure (0.25% total):
- LP rewards: 60%
- ZEN stakers: TBD%
- Protocol treasury: TBD%
```

**Key insight:** Convert ALL fees to native token BEFORE distribution.

### Current NoctFinance Approach

We don't have a governance token yet, but we should plan the fee structure:

```solidity
// Current: fees accrue in-kind (USDC fees stay USDC)
mapping(address => uint256) public protocolFees;
```

### Proposed Improvement

**Design fee structure with native token buy pressure:**

1. **When we launch governance token (NOCT):**
   ```solidity
   // All protocol fees → swap to NOCT → distribute
   uint256 constant FEE_BPS = 10; // 0.1% fee
   
   struct FeeAllocation {
       uint16 suppliers;     // 40% (4000 bps)
       uint16 noctStakers;   // 40% (4000 bps)
       uint16 treasury;      // 20% (2000 bps)
   }
   
   function distributeFees(address asset) external {
       uint256 fees = protocolFees[asset];
       // Swap to NOCT via Uniswap/Aerodrome
       uint256 noctAmount = swapToNoct(asset, fees);
       // Distribute according to allocation
       distributeNoct(noctAmount, feeAllocation);
   }
   ```

2. **Creates flywheel:**
   - More trading → more fees
   - More fees → more NOCT bought
   - More NOCT bought → price pressure
   - Higher NOCT price → more stakers
   - More stakers → better governance

**Impact:**
- Token demand tied to protocol usage
- Sustainable revenue model
- Fair distribution to stakeholders

**Implementation effort:** Medium (when governance is ready)
- Fee collection in contracts
- Swap router integration
- Distribution logic
- Staking contract

---

## 5. Boost Manager Pattern

### Zendex Pattern

**Problem:** Incentivize long-term token holding without complex vesting.

**Zendex Solution:**
```solidity
// Stake ZKZ token → get boost on cashback
boost = 500 + 2000 × average(amount_factor, duration_factor)
boost capped at 2500 basis points (25%)

Staking parameters:
- Minimum: 1,000 ZKZ
- Lockup: 1-24 periods
- Boost increases with amount + duration
```

**Why this matters:**
- Simple for users (stake = boost)
- No complex vesting schedules
- Rewards long-term holders
- Flexible lockup periods

### Current NoctFinance Approach

We don't have staking yet.

### Proposed Improvement

**When we add NOCT staking:**

```solidity
contract BoostManager {
    struct Stake {
        uint256 amount;
        uint256 startTime;
        uint256 lockupPeriods; // 1-24 months
    }
    
    function calculateBoost(address user) public view returns (uint256) {
        Stake memory stake = stakes[user];
        
        // Amount factor: % of total supply staked
        uint256 amountFactor = (stake.amount * 10000) / totalStaked;
        
        // Duration factor: lockup periods / 24
        uint256 durationFactor = (stake.lockupPeriods * 10000) / 24;
        
        // Average and scale
        uint256 boost = 500 + (2000 * (amountFactor + durationFactor)) / 20000;
        
        // Cap at 25%
        return boost > 2500 ? 2500 : boost;
    }
    
    function applyBoost(uint256 baseFee) public view returns (uint256) {
        uint256 boost = calculateBoost(msg.sender);
        // User gets (boost / 10000) of their fees back
        return (baseFee * boost) / 10000;
    }
}
```

**Impact:**
- Incentivizes NOCT holding
- Rewards long-term users
- Reduces sell pressure
- Fair boost calculation

**Implementation effort:** Medium (when governance ready)
- BoostManager contract
- Staking mechanism
- Boost calculation
- Integration with fee distribution

---

## 6. UUPS Upgradeability Pattern

### Zendex Pattern

**All manager contracts use UUPS proxy:**
```solidity
contract ZendexVaultManager is UUPSUpgradeable {
    // Upgradeable without changing contract address
    // Users never need to approve new contracts
}

// Non-upgradeable: Core custody contracts
contract ZendexVault {
    // Token custody is immutable for security
}
```

**Decision rule:**
- **Upgradeable:** Business logic, fee parameters, routing
- **Non-upgradeable:** Token custody, verification, core security

### Current NoctFinance Approach

We use UUPS for pools:
```solidity
contract ShieldedSupplyPool is Initializable, UUPSUpgradeable {
    // Already following this pattern ✅
}
```

### Recommendation

**Keep current pattern, but document upgrade policy:**

```solidity
// UPGRADE POLICY (add to contracts)
/**
 * @notice This contract is upgradeable via UUPS pattern
 * @dev Upgrade authority: Multisig (3/5) → Timelock (48h) → Governance (future)
 * 
 * Upgradeable contracts:
 * - ShieldedSupplyPool (business logic)
 * - ShieldedPositionPool (business logic)
 * - LiquidationBoard (liquidation rules)
 * - AssetRegistry (asset parameters)
 * 
 * Non-upgradeable contracts:
 * - ZkVerifier (proof verification - immutable)
 * - PrivacyEntry (commitment/nullifier storage - immutable)
 * - CommitmentRegistry (Merkle tree - immutable)
 */
```

**Implementation effort:** Low (documentation only)
- Add upgrade policy comments
- Document timelock process
- Tests for upgrade scenarios

---

## 7. Router Pattern for Fee Collection

### Zendex Pattern

**Problem:** Collecting fees from multiple operations is complex.

**Zendex Solution:**
```solidity
contract ZendexRouter {
    // All operations route through here
    // Router automatically:
    // 1. Executes the operation
    // 2. Calculates fees
    // 3. Sends fees to RewardsEngine
    // 4. Returns result to user
    
    function swapThroughRouter(
        address tokenIn,
        address tokenOut,
        uint256 amount
    ) external returns (uint256) {
        // Execute swap
        uint256 output = pair.swap(tokenIn, tokenOut, amount);
        
        // Collect fee
        uint256 fee = (output * FEE_BPS) / 10000;
        rewardsEngine.collectFee(tokenOut, fee);
        
        // Return net output
        return output - fee;
    }
}
```

### Current NoctFinance Approach

Fees are collected directly in operations:
```solidity
function supply(bytes memory proof) external {
    // Verify proof
    // Update balance
    // (Fees are implicit in interest calculation)
}
```

### Proposed Improvement

**Add explicit fee routing:**

```solidity
contract NoctRouter {
    IRewardsEngine public rewardsEngine;
    
    function supplyWithFees(
        bytes memory proof,
        uint256 amount
    ) external returns (uint256 netSupplied) {
        // Execute supply
        pool.supply(proof);
        
        // Collect protocol fee (if any)
        uint256 fee = (amount * SUPPLY_FEE_BPS) / 10000;
        if (fee > 0) {
            rewardsEngine.collectFee(asset, fee);
        }
        
        return amount - fee;
    }
}
```

**Impact:**
- Centralized fee logic
- Easier to audit fees
- Simpler fee distribution

**Implementation effort:** Low-Medium (1-2 days)
- Create NoctRouter contract
- Route operations through it
- Update frontend to use router

---

## Implementation Priority

### High Priority (Phase 3)
1. **Inclusion Proof Optimization** — significant performance gain
2. **Dust Handling** — prevents rounding issues
3. **Operator Roles** — enables batching

### Medium Priority (Phase 4)
4. **Router Pattern** — cleaner fee handling
5. **UUPS Documentation** — governance preparation

### Low Priority (Post-Mainnet)
6. **Fee Split + Boost** — requires governance token
7. **Staking Mechanics** — requires governance token

---

## Summary

**From Zendex analysis, we should implement:**

✅ **Now (Phase 2-3):**
- Inclusion proof optimization (performance)
- Dust handling (correctness)
- Operator roles (batching)

⏳ **Later (Phase 4-5):**
- Router pattern (architecture)
- Upgrade policy docs (governance prep)

🔮 **Future (Post-Launch):**
- Fee split with native buy pressure
- Boost mechanism
- Full governance

**Total identified patterns:** 7  
**Immediate value patterns:** 3  
**Estimated implementation:** 5-7 days for high-priority items

---

**Next steps:**
1. Review these patterns with the team
2. Prioritize based on Phase 2 completion
3. Create implementation tasks for Phase 3
4. Estimate gas savings from optimizations
