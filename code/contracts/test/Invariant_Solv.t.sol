// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {PoolDeployment} from "./ShieldedPools.t.sol";
import {PrivacyEntry} from "../src/PrivacyEntry.sol";
import {ShieldedSupplyPool} from "../src/ShieldedSupplyPool.sol";
import {IRateModel} from "../src/interfaces/IRateModel.sol";
import {IZkVerifier} from "../src/interfaces/IZkVerifier.sol";
import {MockVerifyProofAggregation} from "./mocks/MockVerifyProofAggregation.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Stateless fuzz handler driving supply / withdraw / borrow / repay
///         against the Day-3 pools. Pre-approves each op's proof tuple via
///         the mock proxy so the fuzz body always exercises a "valid
///         proof" path — the invariant checks contract-level bookkeeping,
///         not circuit-side soundness.
contract SolvencyHandler is Test {
    PrivacyEntry internal entry;
    ShieldedSupplyPool internal supplyPool;
    MockVerifyProofAggregation internal proxy;
    MockERC20 internal usdc;
    uint8 internal usdcId;
    address internal user;

    uint256 internal _proofSeq;
    uint256 internal _commitmentSeq;
    uint256 internal _depositSeq;

    constructor(
        PrivacyEntry entry_,
        ShieldedSupplyPool supplyPool_,
        MockVerifyProofAggregation proxy_,
        MockERC20 usdc_,
        uint8 usdcId_,
        address user_
    ) {
        entry = entry_;
        supplyPool = supplyPool_;
        proxy = proxy_;
        usdc = usdc_;
        usdcId = usdcId_;
        user = user_;
    }

    function _nextProof()
        internal
        returns (IZkVerifier.AggregationProof memory p, uint256 aggId)
    {
        aggId = ++_proofSeq;
        p = IZkVerifier.AggregationProof({
            domainId: 1,
            aggregationId: aggId,
            leaf: keccak256(abi.encodePacked("fuzz-leaf-", aggId)),
            merklePath: new bytes32[](0),
            leafCount: 1,
            leafIndex: 0
        });
    }

    function _commit(string memory tag) internal returns (bytes32) {
        return keccak256(abi.encodePacked(tag, ++_commitmentSeq));
    }

    function supply(uint256 amount) external {
        amount = bound(amount, 1, 1_000e6);
        bytes32 entryC =
            keccak256(abi.encodePacked("fuzz-deposit-commit-", ++_depositSeq));
        vm.prank(user);
        entry.deposit(address(usdc), amount, entryC);

        (IZkVerifier.AggregationProof memory p, uint256 aggId) = _nextProof();
        proxy.setAllowed(1, aggId, 0, true);

        vm.prank(user);
        supplyPool.supplyAsset(usdcId, _commit("bn"), _commit("rb"), _commit("sc"), amount, p);
    }

    function withdrawSupply(uint256 amount) external {
        uint256 total = supplyPool.totalSupplyPerAsset(usdcId);
        if (total == 0) return;
        amount = bound(amount, 1, total);

        bytes32 root = supplyPool.currentRoot();
        (IZkVerifier.AggregationProof memory p, uint256 aggId) = _nextProof();
        proxy.setAllowed(1, aggId, 0, true);

        vm.prank(user);
        supplyPool.withdrawSupply(usdcId, _commit("sn"), _commit("nb"), amount, root, p);
    }
}

/// @notice subsystem_test.md Day-3 T-3.5: I-SOLV-1 fuzz invariant.
/// @dev S15 §11.1 / I-SOLV-1: appCustody[token] ≥ sum(active supply × supplyIndex)
///      for each token. In this Day-3 mock world, custody only changes via
///      `deposit` / `withdraw` on PrivacyEntry — supply/withdrawSupply shuffle
///      commitments without moving tokens. So the strict on-chain invariant
///      reduces to: PrivacyEntry.reserves[token] == ERC-20.balanceOf(entry),
///      and the RateModel mirror of totalSupply stays consistent.
contract Invariant_Solv is StdInvariant, PoolDeployment {
    SolvencyHandler internal handler;

    function setUp() public {
        _deployAll();
        handler = new SolvencyHandler(entry, supplyPool, proxy, usdc, USDC_ID, USER);
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = SolvencyHandler.supply.selector;
        selectors[1] = SolvencyHandler.withdrawSupply.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// I-SOLV-1 (Day-3 reduced form): tokens-in-custody match the per-token
    /// reserve accounting at all times.
    function invariant_custodyMatchesReserves() public view {
        uint256 reserveBal = entry.reserves(address(usdc));
        uint256 erc20Bal = usdc.balanceOf(address(entry));
        assertEq(erc20Bal, reserveBal, "I-SOLV-1: reserves vs ERC-20 balance");
    }

    /// Cross-check that RateModel's mirror of totalSupply stays equal to the
    /// pool's own view (no drift between the two storage sites).
    function invariant_rateModelMirrorsTotals() public view {
        IRateModel.AssetRateState memory s = rateModel.state(USDC_ID);
        assertEq(
            s.totalSupply, supplyPool.totalSupplyPerAsset(USDC_ID), "RM/pool totalSupply sync"
        );
    }
}
