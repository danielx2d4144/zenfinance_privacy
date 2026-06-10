// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import {Script, console} from "forge-std/Script.sol";

import {ZkVerifier} from "../src/ZkVerifier.sol";
import {PrivacyEntry} from "../src/PrivacyEntry.sol";
import {AssetRegistry} from "../src/AssetRegistry.sol";
import {RateModel} from "../src/RateModel.sol";
import {Oracle} from "../src/Oracle.sol";
import {InsuranceFund} from "../src/InsuranceFund.sol";
import {ShieldedSupplyPool} from "../src/ShieldedSupplyPool.sol";
import {ShieldedPositionPool} from "../src/ShieldedPositionPool.sol";
import {LiquidationBoard} from "../src/LiquidationBoard.sol";
import {VkRegistry} from "../src/libraries/VkRegistry.sol";
import {IAssetRegistry} from "../src/interfaces/IAssetRegistry.sol";
import {IRateModel} from "../src/interfaces/IRateModel.sol";
import {IZkVerifier} from "../src/interfaces/IZkVerifier.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {MockVerifyProofAggregation} from "../test/mocks/MockVerifyProofAggregation.sol";

/// @notice Day-10 T-10.1 harness: deploys the full lending stack on Anvil,
///         emits 100 mixed events (50 PrivacyEntry.Deposited +
///         50 ZkVerifier.ProofConsumed), and dumps the deployed addresses
///         to `code/backend/subgraph/anvil-addrs.json` so the subgraph
///         render script can wire them into subgraph.anvil.yaml.
contract EmitTestEvents is Script {
    uint8 internal constant USDC_ID = 0;
    uint8 internal constant CBBTC_ID = 1;
    uint256 internal constant RAY = 1e27;

    struct Deployment {
        MockVerifyProofAggregation proxy;
        ZkVerifier zk;
        MockERC20 usdc;
        MockERC20 cbBtc;
        PrivacyEntry pe;
        AssetRegistry reg;
        RateModel rm;
        Oracle oracle;
        InsuranceFund ifund;
        ShieldedSupplyPool ssp;
        ShieldedPositionPool spp;
        LiquidationBoard lb;
    }

    function run() external {
        uint256 pk = vm.envOr(
            "ANVIL_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address admin = vm.addr(pk);

        vm.startBroadcast(pk);
        Deployment memory d = _deployStack(admin);
        _seedDeposits(d, admin);
        _emitProofs(d.zk, d.proxy);
        vm.stopBroadcast();

        _dumpAddresses(d);
    }

    function _deployStack(address admin) internal returns (Deployment memory d) {
        d.proxy = new MockVerifyProofAggregation();
        d.zk = new ZkVerifier(admin, address(d.proxy), VkRegistry.pack());
        d.zk.grantRole(d.zk.CALLER_ROLE(), admin);

        d.usdc = new MockERC20("Mock USDC", "USDC", 6);
        d.cbBtc = new MockERC20("Mock cbBTC", "cbBTC", 8);
        d.pe = new PrivacyEntry(admin, address(d.zk));
        d.oracle = new Oracle(admin, address(0));

        d.reg = new AssetRegistry(admin);
        d.reg.grantRole(d.reg.MANAGER_ROLE(), admin);
        d.reg.enableAsset(USDC_ID, _cfg(address(d.usdc), 6, address(d.oracle)));
        d.reg.enableAsset(CBBTC_ID, _cfg(address(d.cbBtc), 8, address(d.oracle)));

        d.rm = new RateModel(admin, address(d.reg));
        d.rm.grantRole(d.rm.MANAGER_ROLE(), admin);
        IRateModel.RateParams memory rp = IRateModel.RateParams({
            uOptimalRay: uint128(8 * RAY / 10),
            slope1Ray: uint128(4 * RAY / 100),
            slope2Ray: uint128(75 * RAY / 100)
        });
        d.rm.initializeAsset(USDC_ID, rp);
        d.rm.initializeAsset(CBBTC_ID, rp);

        d.ifund = new InsuranceFund(admin, address(d.reg));

        d.ssp = new ShieldedSupplyPool(admin, address(d.reg), address(d.rm), address(d.pe), address(d.zk));
        d.spp = new ShieldedPositionPool(admin, address(d.reg), address(d.rm), address(d.pe), address(d.zk));
        d.lb = new LiquidationBoard(
            admin,
            address(d.reg),
            address(d.oracle),
            address(d.pe),
            address(d.spp),
            address(d.ifund),
            address(d.zk)
        );

        // Cross-contract role grants required for Day-14b handlers:
        //   - CALLER_ROLE on ZkVerifier: every contract that calls verifyAndConsume
        //   - POOL_ROLE on PrivacyEntry: pools call spendBalance/creditBalance
        //   - LIQUIDATOR_ROLE on ShieldedPositionPool: LiquidationBoard calls applyLiquidation
        //   - REGISTRAR_ROLE on LiquidationBoard: relayer registers position triggers
        // Tests in EntryFlow.t.sol wire these per-contract; here we wire them
        // all at boot so the handlers don't have to.
        d.zk.grantRole(d.zk.CALLER_ROLE(), address(d.pe));
        d.zk.grantRole(d.zk.CALLER_ROLE(), address(d.ssp));
        d.zk.grantRole(d.zk.CALLER_ROLE(), address(d.spp));
        d.zk.grantRole(d.zk.CALLER_ROLE(), address(d.lb));

        d.pe.grantRole(d.pe.POOL_ROLE(), address(d.ssp));
        d.pe.grantRole(d.pe.POOL_ROLE(), address(d.spp));
        d.pe.grantRole(d.pe.POOL_ROLE(), address(d.lb));

        d.rm.grantRole(d.rm.POOL_ROLE(), address(d.ssp));
        d.rm.grantRole(d.rm.POOL_ROLE(), address(d.spp));

        d.spp.grantRole(d.spp.LIQUIDATOR_ROLE(), address(d.lb));

        d.lb.grantRole(d.lb.REGISTRAR_ROLE(), admin);
    }

    /// @dev BN254 Fr prime. Day 14c Stage A: every leaf inserted into a
    ///      PoseidonIMT must be a Field element. Seed commitments built
    ///      from keccak("...") are reduced mod this prime so the seed
    ///      script doesn't trip the `Poseidon2: input >= PRIME` guard.
    uint256 internal constant BN254_FR =
        0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;

    function _seedDeposits(Deployment memory d, address recipient) internal {
        // Mint to the broadcaster (= admin). Forge's `msg.sender` inside
        // a script function resolves to Foundry's DefaultSender, NOT the
        // address signing the broadcast tx -- so the deposits below
        // would otherwise revert with InsufficientBalance.
        d.usdc.mint(recipient, 10_000_000_000 * 10**6);
        d.usdc.approve(address(d.pe), type(uint256).max);
        for (uint256 i = 0; i < 50; ++i) {
            uint256 raw = uint256(keccak256(abi.encodePacked("commitment", i)));
            bytes32 commitment = bytes32(raw % BN254_FR);
            d.pe.deposit(address(d.usdc), 1_000_000 + i, commitment);
        }
    }

    function _emitProofs(ZkVerifier zk, MockVerifyProofAggregation proxy) internal {
        bytes32 entryDepositVk = zk.vkHash(uint8(IZkVerifier.CircuitId.ENTRY_DEPOSIT));
        for (uint256 i = 0; i < 50; ++i) {
            uint256 domain = 2;
            uint256 aggId = 100_000 + i;
            uint256 leafIdx = 0;
            proxy.setAllowed(domain, aggId, leafIdx, true);
            IZkVerifier.AggregationProof memory p = IZkVerifier.AggregationProof({
                domainId: domain,
                aggregationId: aggId,
                leaf: keccak256(abi.encodePacked("leaf", i)),
                merklePath: new bytes32[](0),
                leafCount: 1,
                leafIndex: leafIdx
            });
            zk.verifyAndConsume(uint8(IZkVerifier.CircuitId.ENTRY_DEPOSIT), entryDepositVk, p);
        }
    }

    function _dumpAddresses(Deployment memory d) internal {
        string memory root = "anvilAddrs";
        vm.serializeAddress(root, "PRIVACY_ENTRY", address(d.pe));
        vm.serializeAddress(root, "SHIELDED_SUPPLY_POOL", address(d.ssp));
        vm.serializeAddress(root, "SHIELDED_POSITION_POOL", address(d.spp));
        vm.serializeAddress(root, "LIQUIDATION_BOARD", address(d.lb));
        vm.serializeAddress(root, "ZK_VERIFIER", address(d.zk));
        vm.serializeAddress(root, "MOCK_PROXY", address(d.proxy));
        vm.serializeAddress(root, "RATE_MODEL", address(d.rm));
        vm.serializeAddress(root, "ORACLE", address(d.oracle));
        vm.serializeAddress(root, "ASSET_REGISTRY", address(d.reg));
        string memory json = vm.serializeAddress(root, "INSURANCE_FUND", address(d.ifund));
        vm.writeJson(json, "../backend/subgraph/anvil-addrs.json");

        console.log("Deployed and emitted 100 events.");
        console.log("PrivacyEntry        :", address(d.pe));
        console.log("ZkVerifier          :", address(d.zk));
        console.log("MockProxy           :", address(d.proxy));
        console.log("RateModel           :", address(d.rm));
        console.log("Oracle              :", address(d.oracle));
        console.log("AssetRegistry       :", address(d.reg));
        console.log("InsuranceFund       :", address(d.ifund));
        console.log("ShieldedSupplyPool  :", address(d.ssp));
        console.log("ShieldedPositionPool:", address(d.spp));
        console.log("LiquidationBoard    :", address(d.lb));
    }

    function _cfg(address token, uint8 decimals, address oracleFeed) internal pure returns (IAssetRegistry.AssetConfig memory) {
        return IAssetRegistry.AssetConfig({
            token: token,
            oracleFeed: oracleFeed,
            decimals: decimals,
            ltvBps: 7_500,
            liquidationThresholdBps: 8_000,
            liquidationBonusBps: 500,
            protocolFeeOfBonusBps: 3_000,
            reserveFactorBps: 1_000,
            closeFactorHfThresholdBps: 9_500,
            minBorrowSize: 0,
            dustDebtThreshold: 0,
            suppliable: true,
            borrowable: true,
            collateralizable: true,
            enabled: false
        });
    }
}
