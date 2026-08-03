// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";

import {DeployHorizenTestnet} from "../../script/DeployHorizenTestnet.s.sol";
import {ZkVerifier} from "../../src/ZkVerifier.sol";
import {IZkVerifier} from "../../src/interfaces/IZkVerifier.sol";
import {IAssetRegistry} from "../../src/interfaces/IAssetRegistry.sol";
import {VkRegistry} from "../../src/libraries/VkRegistry.sol";

/// @dev Exposes the script's internals so the fork test can run the exact same
///      code path `run()` broadcasts, minus the broadcast and the manifest write.
contract DeployHarness is DeployHorizenTestnet {
    function preflight(address admin, address proxy) external view {
        _preflight(admin, proxy);
    }

    function deployStack(address admin, address proxy)
        external
        returns (Deployment memory)
    {
        return _deployStack(admin, proxy);
    }
}

/// @notice M3 Phase-1 pre-flight: run the Horizen deploy against a **fork of the
///         real chain**, so the stack is wired to the genuine zkVerify proxy
///         bytecode rather than `MockVerifyProofAggregation`.
///
/// @dev This is the last check that can be made before spending real gas. It
///      catches a wrong proxy address, a missing role grant, a bad asset config
///      and a chain-id mismatch; it cannot catch gas exhaustion.
///
///      Skipped automatically when `HORIZEN_TESTNET_HTTPS` is unset, so the
///      default `forge test` run stays offline and deterministic.
contract DeployHorizenTestnetForkTest is Test {
    uint8 internal constant USDC_ID = 0;
    uint8 internal constant CBBTC_ID = 1;

    address internal constant ZKVERIFY_PROXY =
        0x3098A6974649478f0133046e44105AA84e868C21;

    DeployHarness internal harness;
    address internal admin;
    bool internal forked;

    function setUp() public {
        string memory rpc = vm.envOr("HORIZEN_TESTNET_HTTPS", string(""));
        if (bytes(rpc).length == 0) return;

        vm.createSelectFork(rpc);
        forked = true;

        harness = new DeployHarness();

        // Under `vm.startBroadcast(pk)` the deployer is both the constructor
        // caller and the `grantRole` caller. `vm.prank` only rewrites the
        // outermost call, so the harness must BE the admin for the role grants
        // inside `_deployStack` to run as they will on-chain.
        admin = address(harness);
        vm.deal(admin, 1 ether);
    }

    function test_preflightAcceptsTheRealProxy() public view {
        if (!forked) return;
        assertEq(block.chainid, 2651420, "fork is not Horizen testnet");
        // Reverts on any failed invariant; reaching the next line is the assert.
        harness.preflight(admin, ZKVERIFY_PROXY);
    }

    function test_preflightRejectsAnAddressWithNoCode() public {
        if (!forked) return;
        vm.expectRevert("zkVerify proxy has no bytecode on this chain");
        harness.preflight(admin, makeAddr("not-a-contract"));
    }

    function test_preflightRejectsAnUnfundedDeployer() public {
        if (!forked) return;
        vm.expectRevert("deployer has no gas");
        harness.preflight(makeAddr("broke"), ZKVERIFY_PROXY);
    }

    function test_fullStackDeploysAgainstTheRealProxy() public {
        if (!forked) return;

        DeployHorizenTestnet.Deployment memory d =
            harness.deployStack(admin, ZKVERIFY_PROXY);

        // ---- the whole point: no mock anywhere in the verification path ----
        assertEq(
            address(d.zk.proxy()),
            ZKVERIFY_PROXY,
            "ZkVerifier must point at the real zkVerify proxy"
        );

        // ---- vkHashes pinned exactly as VkRegistry declares them ----
        bytes32[] memory expected = VkRegistry.pack();
        for (uint8 i = 0; i < 11; ++i) {
            assertEq(d.zk.vkHash(i), expected[i], "vkHash drift");
        }

        // ---- cross-contract role grants (the easy thing to get wrong) ----
        bytes32 callerRole = d.zk.CALLER_ROLE();
        assertTrue(d.zk.hasRole(callerRole, address(d.pe)), "pe CALLER_ROLE");
        assertTrue(d.zk.hasRole(callerRole, address(d.ssp)), "ssp CALLER_ROLE");
        assertTrue(d.zk.hasRole(callerRole, address(d.spp)), "spp CALLER_ROLE");
        assertTrue(d.zk.hasRole(callerRole, address(d.lb)), "lb CALLER_ROLE");

        // Deliberately NOT granted on a public chain — on Anvil the harness held
        // this so it could mint synthetic ProofConsumed events.
        assertFalse(
            d.zk.hasRole(callerRole, admin),
            "admin must not be able to consume replay slots directly"
        );

        bytes32 poolRole = d.pe.POOL_ROLE();
        assertTrue(d.pe.hasRole(poolRole, address(d.ssp)), "ssp POOL_ROLE");
        assertTrue(d.pe.hasRole(poolRole, address(d.spp)), "spp POOL_ROLE");
        assertTrue(d.pe.hasRole(poolRole, address(d.lb)), "lb POOL_ROLE");

        bytes32 rmPoolRole = d.rm.POOL_ROLE();
        assertTrue(d.rm.hasRole(rmPoolRole, address(d.ssp)), "ssp RateModel POOL_ROLE");
        assertTrue(d.rm.hasRole(rmPoolRole, address(d.spp)), "spp RateModel POOL_ROLE");

        assertTrue(
            d.spp.hasRole(d.spp.LIQUIDATOR_ROLE(), address(d.lb)),
            "lb LIQUIDATOR_ROLE"
        );
        assertTrue(
            d.lb.hasRole(d.lb.REGISTRAR_ROLE(), admin),
            "admin REGISTRAR_ROLE"
        );

        // ---- assets live and priced ----
        IAssetRegistry.AssetConfig memory usdc = d.reg.assets(USDC_ID);
        assertTrue(usdc.enabled, "USDC not enabled");
        assertEq(usdc.token, address(d.usdc), "USDC token mismatch");
        assertEq(usdc.decimals, 6, "USDC decimals");

        IAssetRegistry.AssetConfig memory btc = d.reg.assets(CBBTC_ID);
        assertTrue(btc.enabled, "cbBTC not enabled");
        assertEq(btc.decimals, 8, "cbBTC decimals");

        assertEq(d.oracle.getPrice(USDC_ID), 1e8, "USDC seed price");
        assertEq(d.oracle.getPrice(CBBTC_ID), 60_000e8, "cbBTC seed price");

        // ---- the faucet works for a stranger, not just the deployer ----
        address visitor = makeAddr("demo-visitor");
        vm.prank(visitor);
        d.usdc.mint(visitor, 10_000e6);
        assertEq(d.usdc.balanceOf(visitor), 10_000e6, "faucet mint failed");
    }

    /// @dev A garbage aggregation must be rejected by the REAL proxy. On Anvil
    ///      this passes trivially because the mock returns whatever was
    ///      whitelisted — which is exactly the theatre this deploy removes.
    function test_realProxyRejectsAFabricatedAggregation() public {
        if (!forked) return;

        DeployHorizenTestnet.Deployment memory d =
            harness.deployStack(admin, ZKVERIFY_PROXY);

        IZkVerifier.AggregationProof memory bogus = IZkVerifier.AggregationProof({
            domainId: 175,
            aggregationId: 999_999_999,
            leaf: keccak256("not a real leaf"),
            merklePath: new bytes32[](0),
            leafCount: 1,
            leafIndex: 0
        });

        bytes32 vk = d.zk.vkHash(uint8(IZkVerifier.CircuitId.ENTRY_DEPOSIT));

        vm.prank(address(d.pe));
        vm.expectRevert();
        d.zk.verifyAndConsume(uint8(IZkVerifier.CircuitId.ENTRY_DEPOSIT), vk, bogus);
    }
}
