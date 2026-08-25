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

/// @notice V3 deployment with Stork oracle integration
contract DeployHorizenTestnetV3_Stork is Script {
    uint8 internal constant USDC_ID = 0;
    uint8 internal constant CBBTC_ID = 1;
    uint256 internal constant RAY = 1e27;
    uint256 internal constant HORIZEN_TESTNET_CHAIN_ID = 2651420;

    address internal constant DEFAULT_ZKVERIFY_PROXY =
        0x3098A6974649478f0133046e44105AA84e868C21;

    // Stork contract on Horizen (same address for testnet and mainnet)
    // Source: https://docs.horizen.io/horizen-chain/integrations/stork-oracle
    address internal constant STORK_CONTRACT = 0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62;

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
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(pk);
        address proxy = vm.envOr("ZKVERIFY_PROXY", DEFAULT_ZKVERIFY_PROXY);
        address storkAddr = vm.envOr("STORK_CONTRACT", STORK_CONTRACT);

        require(storkAddr != address(0), "STORK_CONTRACT not set");

        _preflight(admin, proxy, storkAddr);

        vm.startBroadcast(pk);
        Deployment memory d = _deployStack(admin, proxy, storkAddr);
        vm.stopBroadcast();

        _writeManifest(d, admin, storkAddr);
    }

    function _preflight(address admin, address proxy, address storkAddr) internal view {
        require(
            block.chainid == HORIZEN_TESTNET_CHAIN_ID,
            "wrong chain: expected Horizen testnet 2651420"
        );

        uint256 size;
        assembly {
            size := extcodesize(proxy)
        }
        require(size > 0, "zkVerify proxy has no bytecode on this chain");

        uint256 storkSize;
        assembly {
            storkSize := extcodesize(storkAddr)
        }
        require(storkSize > 0, "Stork contract has no bytecode on this chain");

        require(admin.balance > 0.005 ether, "deployer has no gas");

        console.log("chain id            :", block.chainid);
        console.log("deployer            :", admin);
        console.log("deployer balance wei:", admin.balance);
        console.log("zkVerify proxy      :", proxy);
        console.log("proxy code size     :", size);
        console.log("Stork contract      :", storkAddr);
        console.log("Stork code size     :", storkSize);
    }

    function _deployStack(address admin, address proxy, address storkAddr)
        internal
        returns (Deployment memory d)
    {
        d.proxy = proxy;
        d.zk = new ZkVerifier(admin, proxy, VkRegistry.pack());

        d.usdc = new MockERC20("ZenFinance Test USDC", "tUSDC", 6);
        d.cbBtc = new MockERC20("ZenFinance Test cbBTC", "tcbBTC", 8);

        d.pe = new PrivacyEntry(admin, address(d.zk));

        // Oracle with Stork integration
        d.oracle = new Oracle(admin, storkAddr);

        // Set staleness windows (can be longer with Stork's frequent updates)
        d.oracle.setStalenessWindow(USDC_ID, 3_600);
        d.oracle.setStalenessWindow(CBBTC_ID, 3_600);

        // Configure Stork feeds
        // Feed IDs: keccak256("BTCUSD"), keccak256("USDCUSD")
        bytes32 btcusdFeed = 0x7404e3d104ea7841c3d9e6fd20adfe99b4ad586bc08d8f3bd3afef894cf184de;
        bytes32 usdcusdFeed = keccak256("USDCUSD");

        d.oracle.setStorkFeed(USDC_ID, usdcusdFeed);
        d.oracle.setStorkFeed(CBBTC_ID, btcusdFeed);

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
        d.lb.grantRole(d.lb.REGISTRAR_ROLE(), admin);
    }

    function _writeManifest(Deployment memory d, address admin, address storkAddr) internal {
        string memory root = "horizenDeployment";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deploymentBlock", block.number);
        vm.serializeAddress(root, "admin", admin);
        vm.serializeAddress(root, "STORK_CONTRACT", storkAddr);
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
        vm.writeJson(json, "./deployments/horizen-testnet-2651420-v3-stork.json");

        console.log("");
        console.log("--- ZenFinance on Horizen testnet (Stork) ---");
        console.log("deployment block    :", block.number);
        console.log("Stork contract      :", storkAddr);
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
            enabled: false
        });
    }
}
