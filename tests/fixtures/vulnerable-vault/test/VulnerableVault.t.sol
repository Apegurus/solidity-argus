// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {VulnerableVault} from "../src/VulnerableVault.sol";

contract VulnerableVaultTest is Test {
    VulnerableVault public vault;
    
    function setUp() public {
        vault = new VulnerableVault();
    }
    
    function test_deposit() public {
        vm.deal(address(this), 1 ether);
        vault.deposit{value: 0.5 ether}();
        assertEq(vault.balances(address(this)), 0.5 ether);
    }
    
    // This test doesn't check for reentrancy — it's intentionally naive
    function test_withdraw_basic() public {
        vm.deal(address(this), 1 ether);
        vault.deposit{value: 0.5 ether}();
        vault.withdraw(payable(address(this)), 0.5 ether);
        assertEq(vault.balances(address(this)), 0 ether);
    }
    
    receive() external payable {}
}
