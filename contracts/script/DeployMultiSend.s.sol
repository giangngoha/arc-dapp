// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MultiSend.sol";

contract DeployMultiSend is Script {
    function run() external {
        vm.startBroadcast();
        MultiSend ms = new MultiSend();
        console.log("MultiSend deployed at:", address(ms));
        vm.stopBroadcast();
    }
}
