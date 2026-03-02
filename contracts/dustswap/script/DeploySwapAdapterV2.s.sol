// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Script.sol";
import {DustSwapAdapterV2} from "../src/DustSwapAdapterV2.sol";

interface IDustPoolV2Admin {
    function setRelayer(address relayer, bool allowed) external;
    function relayers(address) external view returns (bool);
    function owner() external view returns (address);
    function paused() external view returns (bool);
}

interface IAggregatorV3Check {
    function latestRoundData()
        external view returns (uint80, int256, uint256, uint256, uint80);
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
}

/// @title DeploySwapAdapterV2 — Multi-chain deployment for DustSwapAdapterV2
///
/// @notice All chain-specific addresses are read from environment variables.
///
/// Required env vars:
///   PRIVATE_KEY          — deployer private key
///   POOL_MANAGER         — Uniswap V4 PoolManager address for target chain
///   DUST_POOL_V2         — DustPoolV2 address for target chain
///   CHAINLINK_ETH_USD    — Chainlink ETH/USD price feed for target chain
///
/// Deployment pipeline:
///
///   STEP 1 — Deploy PoseidonT6 library (skip if already deployed):
///     forge script script/DeploySwapAdapterV2.s.sol \
///       --sig "deployPoseidon()" \
///       --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast --slow
///
///   STEP 2 — Simulate (dry run):
///     forge script script/DeploySwapAdapterV2.s.sol \
///       --rpc-url $RPC_URL --private-key $PRIVATE_KEY
///
///   STEP 3 — Deploy + configure:
///     forge script script/DeploySwapAdapterV2.s.sol \
///       --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast --slow --verify
///
///   STEP 4 — Post-deploy verification:
///     forge script script/DeploySwapAdapterV2.s.sol \
///       --sig "verify(address)" <ADAPTER_ADDRESS> --rpc-url $RPC_URL
contract DeploySwapAdapterV2 is Script {

    // ─── Step 1: Deploy PoseidonT6 Library ──────────────────────────────────────

    /// @notice Deploy PoseidonT6 library. Run first, record address, update foundry.toml.
    function deployPoseidon() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== Step 1: Deploy PoseidonT6 ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);
        address poseidonT6 = deployCode("poseidon-solidity/PoseidonT6.sol:PoseidonT6");
        vm.stopBroadcast();

        console.log("PoseidonT6 deployed:", poseidonT6);
        console.log("");
        console.log("=== ACTION REQUIRED ===");
        console.log("Add to foundry.toml libraries[]:");
        console.log(
            string(abi.encodePacked(
                '  "poseidon-solidity/PoseidonT6.sol:PoseidonT6:',
                vm.toString(poseidonT6),
                '"'
            ))
        );
    }

    // ─── Step 2+3: Full Deployment ──────────────────────────────────────────────

    /// @notice Deploy DustSwapAdapterV2 + configure oracle + authorize relayer on pool.
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address poolManager = vm.envAddress("POOL_MANAGER");
        address dustPoolV2 = vm.envAddress("DUST_POOL_V2");
        address chainlinkFeed = vm.envAddress("CHAINLINK_ETH_USD");

        console.log("========================================");
        console.log("  DustSwapAdapterV2 Production Deploy");
        console.log("========================================");
        console.log("");
        console.log("--- Pre-flight ---");
        console.log("Chain ID:     ", block.chainid);
        console.log("Deployer:     ", deployer);
        console.log("Balance:      ", deployer.balance);
        console.log("PoolManager:  ", poolManager);
        console.log("DustPoolV2:   ", dustPoolV2);
        console.log("Chainlink:    ", chainlinkFeed);

        require(deployer.balance > 0.01 ether, "Insufficient deployer balance");

        IDustPoolV2Admin pool = IDustPoolV2Admin(dustPoolV2);
        require(pool.owner() == deployer, "Deployer is not DustPoolV2 owner");
        require(!pool.paused(), "DustPoolV2 is paused");

        IAggregatorV3Check oracle = IAggregatorV3Check(chainlinkFeed);
        (, int256 price,,uint256 updatedAt,) = oracle.latestRoundData();
        require(price > 0, "Chainlink returning zero price");
        require(block.timestamp - updatedAt < 3600, "Chainlink feed stale");
        console.log("Chainlink ETH/USD: $", uint256(price) / 1e8);
        console.log("Feed description:  ", oracle.description());
        console.log("Feed decimals:     ", oracle.decimals());
        console.log("");

        vm.startBroadcast(deployerKey);

        DustSwapAdapterV2 adapter = new DustSwapAdapterV2(
            poolManager,
            dustPoolV2
        );
        console.log("[1/4] DustSwapAdapterV2 deployed:", address(adapter));

        adapter.setRelayer(deployer, true);
        console.log("[2/4] Relayer authorized on adapter:", deployer);

        adapter.setPriceOracle(chainlinkFeed);
        console.log("[3/4] Chainlink oracle configured:", chainlinkFeed);

        pool.setRelayer(address(adapter), true);
        console.log("[4/4] Adapter authorized on DustPoolV2:", address(adapter));

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("  Deployment Complete");
        console.log("========================================");
        console.log("");
        console.log("DustSwapAdapterV2:    ", address(adapter));
        console.log("Owner:                ", adapter.owner());
        console.log("Relayer authorized:   ", adapter.authorizedRelayers(deployer));
        console.log("Oracle:               ", address(adapter.priceOracle()));
        console.log("Max deviation (bps):  ", adapter.maxOracleDeviationBps());
        console.log("Pool authorized:      ", pool.relayers(address(adapter)));
        console.log("");
        console.log("=== REQUIRED UPDATES ===");
        console.log("1. src/config/chains.ts  -> dustSwapAdapterV2:", address(adapter));
        console.log("2. docs/CONTRACTS.md     -> DustSwapAdapterV2 section");
        console.log("3. Verify on explorer:");
        console.log(
            string(abi.encodePacked(
                "   forge verify-contract ",
                vm.toString(address(adapter)),
                " DustSwapAdapterV2 --chain ",
                vm.toString(block.chainid),
                " --etherscan-api-key $ETHERSCAN_API_KEY"
            ))
        );
    }

    // ─── Post-Deploy Verification ─────────────────────────────────────────────

    /// @notice Read-only verification of a deployed adapter.
    ///         Usage: forge script script/DeploySwapAdapterV2.s.sol \
    ///           --sig "verify(address)" <ADAPTER_ADDRESS> --rpc-url $RPC_URL
    function verify(address adapterAddr) external view {
        address dustPoolV2 = vm.envAddress("DUST_POOL_V2");
        address poolManager = vm.envAddress("POOL_MANAGER");
        address chainlinkFeed = vm.envAddress("CHAINLINK_ETH_USD");

        DustSwapAdapterV2 adapter = DustSwapAdapterV2(payable(adapterAddr));

        console.log("========================================");
        console.log("  Post-Deploy Verification");
        console.log("========================================");
        console.log("");

        address owner = adapter.owner();
        console.log("Owner:             ", owner);

        address pm = address(adapter.POOL_MANAGER());
        address dp = address(adapter.DUST_POOL_V2());
        console.log("PoolManager:       ", pm);
        console.log("DustPoolV2:        ", dp);
        require(pm == poolManager, "FAIL: Wrong PoolManager");
        require(dp == dustPoolV2, "FAIL: Wrong DustPoolV2");
        console.log("  -> PASS: Immutables correct");

        bool relayerOk = adapter.authorizedRelayers(owner);
        console.log("Relayer authorized:", relayerOk);
        require(relayerOk, "FAIL: Relayer not authorized");
        console.log("  -> PASS: Relayer set");

        address oracleAddr = address(adapter.priceOracle());
        uint256 deviation = adapter.maxOracleDeviationBps();
        console.log("Oracle:            ", oracleAddr);
        console.log("Max deviation:     ", deviation, "bps");
        require(oracleAddr == chainlinkFeed, "FAIL: Wrong oracle");
        require(deviation == 1000, "FAIL: Unexpected deviation");
        console.log("  -> PASS: Oracle configured");

        IAggregatorV3Check feed = IAggregatorV3Check(oracleAddr);
        (, int256 price,, uint256 updatedAt,) = feed.latestRoundData();
        require(price > 0, "FAIL: Oracle returning zero");
        require(block.timestamp - updatedAt < 3600, "FAIL: Oracle stale");
        console.log("ETH/USD price:     $", uint256(price) / 1e8);
        console.log("Last updated:      ", updatedAt);
        console.log("  -> PASS: Oracle live");

        IDustPoolV2Admin pool = IDustPoolV2Admin(dustPoolV2);
        bool poolAuth = pool.relayers(adapterAddr);
        console.log("Pool auth:         ", poolAuth);
        require(poolAuth, "FAIL: Adapter not authorized on pool");
        console.log("  -> PASS: Pool authorization");

        console.log("");
        console.log("========================================");
        console.log("  ALL CHECKS PASSED");
        console.log("========================================");
    }
}
