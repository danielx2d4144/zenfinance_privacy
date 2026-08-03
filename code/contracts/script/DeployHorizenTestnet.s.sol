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
import {MockERC20} from "../test/mocks/MockERC20.sol";

/// @notice M3 — deploys the full lending stack to Horizen testnet (2651420)
///         against the REAL zkVerify aggregation proxy.
///
/// @dev This is deliberately NOT `EmitTestEvents.s.sol` with a different RPC.
///      Three things that are fine on Anvil are disqualifying on a public chain,
///      and each is fixed here:
///
///        1. `EmitTestEvents` wires `MockVerifyProofAggregation`, whose
///           `verifyProofAggregation` returns whatever was whitelisted. Here the
///           proxy is zkVerify's real one, so proofs are actually checked.
///        2. `EmitTestEvents` defaults the deployer to the world-known Anvil key
///           `0xac0974…ff80`. Deploying with it hands DEFAULT_ADMIN_ROLE to an
///           address everyone holds the key to — anyone could pause the protocol
///           mid-demo. `DEPLOYER_PRIVATE_KEY` here has no default and no fallback.
///        3. `EmitTestEvents` emits 50 synthetic `ProofConsumed` events so the
///           subgraph has something to index. Fake proof events on a public chain
///           are exactly the thing a reviewer would (rightly) call us out for, so
///           there are none.
///
///      Kept verbatim from `EmitTestEvents._deployStack`: the cross-contract role
///      grants, which are the part that is easy to get subtly wrong.
///
///      Usage (see docs/DEPLOY_HORIZEN.md):
///        source ~/.zenfinance/horizen-deployer.env
///        forge script script/DeployHorizenTestnet.s.sol:DeployHorizenTestnet \
///          --rpc-url $HORIZEN_TESTNET_HTTPS --broadcast --slow
contract DeployHorizenTestnet is Script {
    uint8 internal constant USDC_ID = 0;
    uint8 internal constant CBBTC_ID = 1;
    uint256 internal constant RAY = 1e27;
    uint256 internal constant HORIZEN_TESTNET_CHAIN_ID = 2651420;

    /// @dev zkVerify aggregation proxy on Horizen testnet, from zkVerify's
    ///      "Supported Networks" table and verified on-chain 2026-08-03
    ///      (ERC-1967, implementation 0x03225ff1…22d51c non-zero).
    address internal constant DEFAULT_ZKVERIFY_PROXY =
        0x3098A6974649478f0133046e44105AA84e868C21;

    struct Deployment {
        address proxy;
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
        // No default. An unset key must fail loudly, not silently deploy from
        // a key that is public knowledge.
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(pk);
        address proxy = vm.envOr("ZKVERIFY_PROXY", DEFAULT_ZKVERIFY_PROXY);

        _preflight(admin, proxy);

        vm.startBroadcast(pk);
        Deployment memory d = _deployStack(admin, proxy);
        vm.stopBroadcast();

        _writeManifest(d, admin);
    }

    // ---------------------------------------------------------------- preflight

    /// @dev Everything that can be known before spending gas. A deploy against a
    ///      dead proxy address would succeed and then fail on the first real
    ///      borrow, which is the worst possible time to find out.
    function _preflight(address admin, address proxy) internal view {
        require(
            block.chainid == HORIZEN_TESTNET_CHAIN_ID,
            "wrong chain: expected Horizen testnet 2651420"
        );

        uint256 size;
        assembly {
            size := extcodesize(proxy)
        }
        require(size > 0, "zkVerify proxy has no bytecode on this chain");

        require(admin.balance > 0.005 ether, "deployer has no gas");

        console.log("chain id            :", block.chainid);
        console.log("deployer            :", admin);
        console.log("deployer balance wei:", admin.balance);
        console.log("zkVerify proxy      :", proxy);
        console.log("proxy code size     :", size);
    }

    // ------------------------------------------------------------------- deploy

    function _deployStack(address admin, address proxy)
        internal
        returns (Deployment memory d)
    {
        d.proxy = proxy;
        d.zk = new ZkVerifier(admin, proxy, VkRegistry.pack());

        // Horizen testnet has no canonical USDC/cbBTC. `MockERC20.mint` is
        // unpermissioned, which is the right call here: it doubles as the demo
        // faucet so a stranger with an invite code can get test funds without
        // us running a faucet service.
        d.usdc = new MockERC20("ZenFinance Test USDC", "tUSDC", 6);
        d.cbBtc = new MockERC20("ZenFinance Test cbBTC", "tcbBTC", 8);

        d.pe = new PrivacyEntry(admin, address(d.zk));

        // Push-price mode (stork_ = address(0)). The price-keeper service
        // heartbeats these; Oracle.MAX_STALENESS_WINDOW is 3600s, so without
        // that heartbeat every borrow and collateral flow reverts within the
        // hour. See the Railway cron in the M3 hosting notes.
        d.oracle = new Oracle(admin, address(0));
        d.oracle.grantRole(d.oracle.MANAGER_ROLE(), admin);
        d.oracle.setStalenessWindow(USDC_ID, 3_600);
        d.oracle.setStalenessWindow(CBBTC_ID, 3_600);
        d.oracle.pushPrice(USDC_ID, 1e8);
        d.oracle.pushPrice(CBBTC_ID, 60_000e8);

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

        d.ssp = new ShieldedSupplyPool(
            admin, address(d.reg), address(d.rm), address(d.pe), address(d.zk)
        );
        d.spp = new ShieldedPositionPool(
            admin, address(d.reg), address(d.rm), address(d.pe), address(d.zk)
        );
        d.lb = new LiquidationBoard(
            admin,
            address(d.reg),
            address(d.oracle),
            address(d.pe),
            address(d.spp),
            address(d.ifund),
            address(d.zk)
        );

        _grantRoles(d, admin);
    }

    /// @dev Identical to `EmitTestEvents._deployStack`'s grants, minus
    ///      `CALLER_ROLE` for `admin` — on Anvil that let the harness call
    ///      `verifyAndConsume` directly to emit seed events. Nothing on a public
    ///      chain should be able to consume replay slots outside a pool.
    function _grantRoles(Deployment memory d, address admin) internal {
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

        // The relayer registers position triggers for the liquidation board.
        d.lb.grantRole(d.lb.REGISTRAR_ROLE(), admin);
    }

    // ----------------------------------------------------------------- manifest

    function _writeManifest(Deployment memory d, address admin) internal {
        string memory root = "horizenDeployment";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deploymentBlock", block.number);
        vm.serializeAddress(root, "admin", admin);
        vm.serializeAddress(root, "ZKVERIFY_PROXY", d.proxy);
        vm.serializeAddress(root, "ZK_VERIFIER", address(d.zk));
        vm.serializeAddress(root, "PRIVACY_ENTRY", address(d.pe));
        vm.serializeAddress(root, "MOCK_USDC", address(d.usdc));
        vm.serializeAddress(root, "MOCK_CBBTC", address(d.cbBtc));
        vm.serializeAddress(root, "ORACLE", address(d.oracle));
        vm.serializeAddress(root, "ASSET_REGISTRY", address(d.reg));
        vm.serializeAddress(root, "RATE_MODEL", address(d.rm));
        vm.serializeAddress(root, "INSURANCE_FUND", address(d.ifund));
        vm.serializeAddress(root, "SHIELDED_SUPPLY_POOL", address(d.ssp));
        vm.serializeAddress(root, "SHIELDED_POSITION_POOL", address(d.spp));
        string memory json =
            vm.serializeAddress(root, "LIQUIDATION_BOARD", address(d.lb));
        vm.writeJson(json, "./deployments/horizen-testnet-2651420.json");

        console.log("");
        console.log("--- ZenFinance on Horizen testnet ---");
        console.log("deployment block    :", block.number);
        console.log("ZkVerifier          :", address(d.zk));
        console.log("PrivacyEntry        :", address(d.pe));
        console.log("ShieldedSupplyPool  :", address(d.ssp));
        console.log("ShieldedPositionPool:", address(d.spp));
        console.log("LiquidationBoard    :", address(d.lb));
        console.log("AssetRegistry       :", address(d.reg));
        console.log("RateModel           :", address(d.rm));
        console.log("Oracle              :", address(d.oracle));
        console.log("InsuranceFund       :", address(d.ifund));
        console.log("tUSDC (faucet)      :", address(d.usdc));
        console.log("tcbBTC (faucet)     :", address(d.cbBtc));
    }

    function _cfg(address token, uint8 decimals, address oracleFeed)
        internal
        pure
        returns (IAssetRegistry.AssetConfig memory)
    {
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
            // AssetRegistry.enableAsset forces this to true; the field is
            // ignored on the way in.
            enabled: false
        });
    }
}
