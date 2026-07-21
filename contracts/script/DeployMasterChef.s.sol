// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MasterChef.sol";

/// @notice Deploy and configure MasterChef on Arc Testnet.
///
/// Usage:
///   forge script script/DeployMasterChef.s.sol \
///     --rpc-url arc \
///     --broadcast \
///     --account deployer \
///     --sender <YOUR_ADDRESS> \
///     -vvvv
///
/// After deploy, fund rewards:
///   1. Approve: cast send <USDC> "approve(address,uint256)" <CHEF> <AMOUNT> --rpc-url arc --account deployer
///   2. Fund:    cast send <CHEF> "fundRewards(uint256)" <AMOUNT> --rpc-url arc --account deployer
contract DeployMasterChef is Script {

    // ── Arc Testnet token addresses ───────────────────────────────────────────
    address constant USDC   = 0x3600000000000000000000000000000000000000;
    address constant EURC   = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
    address constant cirBTC = 0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF;

    // ── LP pair addresses (checksummed EIP-55 format) ─────────────────────────
    address constant PAIR_USDC_EURC   = 0x5eFf76b80A58ea34b23d0981bCCe2E639171c9cb;
    address constant PAIR_USDC_CIRBTC = 0xa1d507a9662012BD43Bf1ba5e03989d750a8C069;
    address constant PAIR_EURC_CIRBTC = 0x4404EC28D88768e3d36c3f8B981f662ABa09D1c0;

    // ── Reward config ─────────────────────────────────────────────────────────
    // 0.001 USDC per second = 86.4 USDC/day
    // Adjust to match your budget and desired APR.
    uint256 constant REWARD_PER_SECOND = 2_00;

    // Allocation points: USDC/EURC 50%, USDC/cirBTC 30%, EURC/cirBTC 20%
    uint256 constant ALLOC_USDC_EURC   = 50;
    uint256 constant ALLOC_USDC_CIRBTC = 30;
    uint256 constant ALLOC_EURC_CIRBTC = 20;

    function run() external {
        vm.startBroadcast();

        // 1. Deploy MasterChef
        MasterChef chef = new MasterChef(USDC, REWARD_PER_SECOND);
        console.log("MasterChef deployed at:", address(chef));
        console.log("Reward per second (USDC raw):", REWARD_PER_SECOND);

        // 2. Add the three LP pools
        chef.addPool(PAIR_USDC_EURC,   ALLOC_USDC_EURC);
        console.log("Pool 0: USDC/EURC   allocPoint=50");

        chef.addPool(PAIR_USDC_CIRBTC, ALLOC_USDC_CIRBTC);
        console.log("Pool 1: USDC/cirBTC allocPoint=30");

        chef.addPool(PAIR_EURC_CIRBTC, ALLOC_EURC_CIRBTC);
        console.log("Pool 2: EURC/cirBTC allocPoint=20");

        vm.stopBroadcast();

        // 3. Print next steps
        console.log("=== NEXT STEPS ===");
        console.log("1. Copy MasterChef address above into app/farm/page.tsx");
        console.log("2. Approve USDC then call fundRewards() to seed the reward pool");
        console.log("   Example: 1000 USDC = 1000000000 (6 decimals)");
    }
}
