// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {BaseAccount} from "@account-abstraction/contracts/core/BaseAccount.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS, _packValidationData}
    from "@account-abstraction/contracts/core/Helpers.sol";

import {IAgentAccount} from "./interfaces/IAgentAccount.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {IHfChecker} from "./interfaces/IHfChecker.sol";

/// @title AgentAccount
/// @notice ERC-4337 v0.7.0 smart account; one per delegating user.
/// @dev Spec: design-v2/subsystems/03_smart_accounts_policies.md §3
///      Two-tier authority:
///        1. The `owner` (an EOA the human controls) can do anything via
///           `execute` (still gated through EntryPoint, still validated).
///        2. Session keys can do *only* what their bound policy allows.
///           validateUserOp checks signature, session liveness, target +
///           selector allowlist, and charges the per-asset spending cap.
///
///      The session signature payload is `abi.encode(sessionId, ECDSA(sig))`
///      — placing sessionId in the signature lets a single AgentAccount
///      have many concurrent agents with different policies.
///
///      Spending is charged during `_validateSignature`, NOT during
///      `execute`, because v0.7.0 validation is the only phase a bundler
///      simulates before paying gas — pushing cap checks here means an
///      over-cap userOp is dropped pre-flight.
contract AgentAccount is BaseAccount, IAgentAccount {
    using MessageHashUtils for bytes32;

    address public immutable override owner;
    IEntryPoint private immutable _entryPoint;
    IPolicyRegistry public immutable policyRegistry;

    /// @dev Optional pluggable HF check; when zero the borrow path skips
    ///      HF enforcement and falls back to cap-only validation. Owner
    ///      sets this once. Day-9 swaps the mock for a real Oracle wrapper.
    IHfChecker public hfChecker;

    error HfFloorBreached(uint16 hfBpsAfter, uint16 floorBps);

    event HfCheckerUpdated(address indexed checker);

    uint256 private _nextSessionId;
    mapping(uint256 sessionId => Session) private _sessions;

    /// @dev Layout of `userOp.callData` MUST be `abi.encodeCall(this.execute,
    ///      (target, value, data))` for session-key paths. The wrapper hides
    ///      the actual pool call inside `data`, which is what we crack open
    ///      to enforce policy.
    bytes4 private constant EXECUTE_SELECTOR = this.execute.selector;

    constructor(address owner_, address entryPoint_, address policyRegistry_) {
        if (owner_ == address(0) || entryPoint_ == address(0) || policyRegistry_ == address(0)) {
            revert ZeroAddress();
        }
        owner = owner_;
        _entryPoint = IEntryPoint(entryPoint_);
        policyRegistry = IPolicyRegistry(policyRegistry_);
    }

    receive() external payable {}

    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    // -------------------------------------------------------------------
    // Owner surface
    // -------------------------------------------------------------------

    function createSession(address agentPubkey, uint256 policyId, uint64 expiresAt)
        external
        returns (uint256 sessionId)
    {
        if (msg.sender != owner) revert NotOwner();
        if (agentPubkey == address(0)) revert ZeroAddress();
        // Bind the policy<->this-account relationship up-front: the policy's
        // owner must equal this account's owner. Without this an attacker
        // who registered a permissive policy elsewhere could use it via any
        // AgentAccount whose owner happened to match the spender role.
        IPolicyRegistry.Policy memory p = policyRegistry.get(policyId);
        if (p.owner != owner) revert PolicyMismatch();

        sessionId = ++_nextSessionId;
        _sessions[sessionId] = Session({
            agentPubkey: agentPubkey,
            policyId: policyId,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            nonce: 0,
            revoked: false
        });
        emit SessionCreated(sessionId, agentPubkey, policyId, expiresAt);
    }

    function revokeSession(uint256 sessionId) external {
        if (msg.sender != owner) revert NotOwner();
        Session storage s = _sessions[sessionId];
        if (s.agentPubkey == address(0)) revert InvalidSession();
        s.revoked = true;
        emit SessionRevoked(sessionId);
    }

    function setHfChecker(address checker) external {
        if (msg.sender != owner) revert NotOwner();
        hfChecker = IHfChecker(checker);
        emit HfCheckerUpdated(checker);
    }

    function sessions(uint256 sessionId)
        external
        view
        returns (
            address agentPubkey,
            uint256 policyId,
            uint64 createdAt,
            uint64 expiresAt,
            uint64 nonce,
            bool revoked
        )
    {
        Session storage s = _sessions[sessionId];
        return (s.agentPubkey, s.policyId, s.createdAt, s.expiresAt, s.nonce, s.revoked);
    }

    // -------------------------------------------------------------------
    // EntryPoint surface
    // -------------------------------------------------------------------

    /// @notice Generic call dispatcher; only callable by EntryPoint after
    ///         validateUserOp has succeeded (or by the owner directly).
    function execute(address target, uint256 value, bytes calldata data) external {
        // Two valid callers: EntryPoint (post-validation) or owner (direct).
        // Owners typically wouldn't call this off-chain — they'd send a
        // userOp signed with sessionId=0 (see _validateSignature) — but
        // direct calls let recovery flows skip the EntryPoint if needed.
        if (msg.sender != address(_entryPoint) && msg.sender != owner) revert NotEntryPoint();

        bytes4 sel;
        if (data.length >= 4) {
            sel = bytes4(data[:4]);
        }
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) revert ExecutionFailed(ret);
        emit Executed(target, value, sel);
    }

    /// @dev v0.7.0 IAccount entrypoint. We override `_validateSignature`
    ///      below; the base contract handles `_requireFromEntryPoint` and
    ///      gas pre-funding.
    function _validateSignature(PackedUserOperation calldata userOp, bytes32 userOpHash)
        internal
        override
        returns (uint256 validationData)
    {
        // The signature payload encodes either:
        //   - sessionId = 0  → owner-signed userOp (full authority)
        //   - sessionId > 0  → session-signed userOp (policy-bound)
        if (userOp.signature.length < 32) return SIG_VALIDATION_FAILED;
        (uint256 sessionId, bytes memory rawSig) =
            abi.decode(userOp.signature, (uint256, bytes));

        bytes32 ethSigned = userOpHash.toEthSignedMessageHash();
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(ethSigned, rawSig);
        if (err != ECDSA.RecoverError.NoError) return SIG_VALIDATION_FAILED;

        if (sessionId == 0) {
            // Owner path: signature must be by the owner; no policy checks.
            return recovered == owner ? SIG_VALIDATION_SUCCESS : SIG_VALIDATION_FAILED;
        }

        Session storage s = _sessions[sessionId];
        if (s.agentPubkey == address(0)) return SIG_VALIDATION_FAILED;
        if (s.revoked) return SIG_VALIDATION_FAILED;
        if (recovered != s.agentPubkey) return SIG_VALIDATION_FAILED;

        // Policy enforcement runs *during validation*. Reverting here is
        // appropriate: an over-cap userOp is malformed authority, not a
        // signature issue, and we want the bundler to surface a typed error
        // rather than silently mark the userOp as failed-sig.
        _enforcePolicy(s.policyId, userOp.callData);

        // Embed the session expiry in the v4337 validation data so the
        // EntryPoint refuses to dispatch an expired userOp even if our
        // own check above somehow misses (defence in depth via v4337 time
        // window — `validUntil` is the honoured upper bound).
        return _packValidationData(false, uint48(s.expiresAt), uint48(s.createdAt));
    }

    /// @dev Decodes `userOp.callData = execute(target, value, innerCall)` and
    ///      checks both the outer (target, selector) allowlist *and* the
    ///      inner pool-call's (assetId, amount). Reverts on any violation.
    function _enforcePolicy(uint256 policyId, bytes calldata callData) private {
        // Outer wrapper must be `execute(...)`. Anything else is rejected
        // wholesale: session keys are not allowed to invoke session-mgmt
        // functions on the account (`createSession`, `revokeSession`) by
        // routing through an EntryPoint userOp.
        if (callData.length < 4) revert CallDataMalformed();
        bytes4 outerSel = bytes4(callData[:4]);
        if (outerSel != EXECUTE_SELECTOR) revert CallSelectorNotAllowed(outerSel);

        // Decode the execute(...) args.
        (address target, /*value*/, bytes memory innerData) =
            abi.decode(callData[4:], (address, uint256, bytes));

        if (innerData.length < 4) revert CallDataMalformed();
        bytes4 innerSel;
        // Solidity's calldata-to-memory decode means innerData is `bytes
        // memory`; pull the selector via assembly to avoid a copy.
        assembly {
            innerSel := mload(add(innerData, 32))
        }

        if (!policyRegistry.isAllowed(policyId, target, innerSel)) {
            revert CallTargetNotAllowed(target);
        }

        // The five pool functions in scope today (supplyAsset,
        // withdrawSupply, depositCollateral, withdrawCollateral, borrow,
        // repay) all share the prefix `(uint8 assetId, ...)`, with the
        // user-controlled token amount appearing as a static uint256 at a
        // known offset. We decode (assetId, amount) using a per-selector
        // offset map — this is the policy-enforcement point that S03 §3
        // step 3 specifies.
        (uint8 assetId, uint128 amount) = _decodeAssetAmount(innerSel, innerData);

        // chargeSpend reverts on cap breach, recording the spend on success.
        // Note: we treat `amount == 0` as a free check (still validates
        // selector+asset are in budget), matching how PrivacyEntry rejects
        // zero-amount calls anyway.
        if (amount > 0) {
            policyRegistry.chargeSpend(policyId, assetId, amount);
        } else {
            // Even zero-value calls must reference an asset that is in budget.
            policyRegistry.budgetFor(policyId, assetId);
        }

        // HF-floor enforcement: only meaningful for the borrow selector
        // (other selectors don't change the debt side of the position).
        // The hook is optional — when unset, validation passes through.
        // Day-9 wires this to S05 Oracle so the floor reflects live prices.
        if (innerSel == 0x42ee8157 && address(hfChecker) != address(0)) {
            IPolicyRegistry.AssetBudget memory ab = policyRegistry.budgetFor(policyId, assetId);
            uint16 hfBpsAfter =
                hfChecker.postOpHfBps(assetId, assetId, amount, innerData);
            // Apply the stricter of per-asset and global floor; both are
            // expressed in bps so they compare directly.
            uint16 floor = ab.hfFloorBps;
            uint16 globalFloor = policyRegistry.get(policyId).globalHfFloorBps;
            if (globalFloor > floor) floor = globalFloor;
            if (hfBpsAfter < floor) revert HfFloorBreached(hfBpsAfter, floor);
        }
    }

    /// @dev Per-selector decoder. Each pool function's parameter layout is
    ///      part of its public ABI; this map captures the (assetId, amount)
    ///      slot positions. Adding a new pool selector means adding a case
    ///      here AND a `bytes4` to the policy's `allowedSelectors`.
    function _decodeAssetAmount(bytes4 selector, bytes memory data)
        private
        pure
        returns (uint8 assetId, uint128 amount)
    {
        // Selectors pinned from the on-chain ABIs of IShieldedSupplyPool
        // and IShieldedPositionPool; if those interfaces change, this
        // decoder must be updated AND every existing policy re-registered
        // with the new selectors. Hard-coding the constants (rather than
        // recomputing keccak per call) keeps validation gas tight.
        uint256 amountSlot;
        if (selector == 0x1c339c20) {
            // supplyAsset(uint8,bytes32,bytes32,bytes32,uint256,(...))
            amountSlot = 4;
        } else if (selector == 0xf7d687ed) {
            // withdrawSupply(uint8,bytes32,bytes32,uint256,bytes32,(...))
            amountSlot = 3;
        } else if (selector == 0x71c60e09) {
            // depositCollateral(uint8,bytes32,bytes32,bytes32,bytes32,uint256,bytes32,(...))
            amountSlot = 5;
        } else if (selector == 0xa0b2ba72) {
            // withdrawCollateral(uint8,bytes32,bytes32,bytes32,uint256,bytes32,(...))
            amountSlot = 4;
        } else if (selector == 0x42ee8157) {
            // borrow(uint8,bytes32,bytes32,bytes32,uint256,bytes32,(...))
            amountSlot = 4;
        } else if (selector == 0xa2902f62) {
            // repay(uint8,bytes32,bytes32,bytes32,bytes32,uint256,bytes32,(...))
            amountSlot = 5;
        } else {
            // Unknown selector: cannot enforce a budget. Returning a
            // sentinel assetId triggers AssetNotInBudget downstream — a
            // policy that explicitly allows this selector still has to
            // include the right asset in its budget, so the failure
            // mode remains clear.
            return (type(uint8).max, 0);
        }

        // ABI: data = [selector(4) | slot0(32) | slot1(32) | ... ]. For
        // `bytes memory`, payload starts at `data + 32` (length prefix),
        // so slot N lives at `data + 32 + 4 + 32*N = data + 36 + 32*N`.
        assembly {
            let base := add(data, 36)
            assetId := byte(31, mload(base))
            // Truncating to uint128 is safe for v1 token amounts (<2^128
            // wei). A cap above 2^128 would be rejected at registration
            // anyway since AssetBudget.capPerEpoch is uint128.
            amount := mload(add(base, mul(amountSlot, 32)))
        }
    }
}
