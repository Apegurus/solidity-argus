// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {VulnerableVault} from "../src/VulnerableVault.sol";

// ─────────────────────────────────────────────────────────────────────────────
// ARGUS EVIDENCE-INTEGRITY CORRECTION
// ─────────────────────────────────────────────────────────────────────────────
//
// This file CORRECTS the earlier ReentrancyPoC.t.sol which contained a
// test-funding error that fabricated a 1 ETH "profit" for the attacker.
//
// THE FLAW IN THE ORIGINAL TEST (ReentrancyPoC.t.sol):
//   setUp() called:
//     vm.deal(address(attacker), 1 ether);   // gives attacker 1 ETH raw balance
//     attacker.deposit{value: 1 ether}();    // test contract (not attacker) pays this
//
//   Because there was no vm.prank(address(attacker)), the test contract's ambient
//   Foundry balance (2^96 ETH) paid the deposit call. The vm.deal'd 1 ETH was
//   NEVER deposited — it sat as un-deposited raw balance in the Attacker contract.
//
//   After attack():
//     attacker.balance = 1 ETH (un-deposited leftover) + 1 ETH (vault withdrawal)
//                      = 2 ETH
//   The test asserted "2 ETH = 1 ETH profit" — but the 1 ETH "profit" was just
//   the un-deposited vm.deal funding. No vault ETH was stolen.
//
// CONSERVATION PROOF (why theft is impossible):
//   withdraw(to, amount):
//     L19: require(balances[to] >= amount)
//     L20: to.call{value: amount}("")        // sends ETH to `to`
//     L22: balances[to] -= amount            // decrements `to`'s own balance
//
//   Both the ETH transfer and the balance decrement operate on the SAME address `to`.
//   An attacker calling withdraw(attacker, X) receives X ETH but also loses X from
//   balances[attacker]. Any attempt to call withdraw(attacker, X) more times than
//   the attacker deposited will underflow balances[attacker] on the unwind stack
//   (Solidity 0.8 checked arithmetic) and revert the entire transaction.
//
//   Therefore: attacker can never extract more ETH from the vault than it deposited.
//   NET VAULT GAIN = 0. THEFT IS IMPOSSIBLE.
//
// REAL IMPACTS (confirmed):
//   1. FORCED-WITHDRAWAL GRIEFING (Medium):
//      Any caller can invoke withdraw(victim, amount) to force-send a victim's
//      balance back to the victim's address. This is griefing / DoS, not theft:
//      - If victim is a contract that rejects ETH (no receive/fallback), the call
//        reverts and the victim's funds are permanently locked in the vault.
//      - If victim is an EOA, their funds are returned to them (not stolen).
//
//   2. LATENT CEI VIOLATION (Informational / architectural lead):
//      The external call precedes the state update (L20 before L22). This is a
//      real CEI violation. In isolation (pure reentrancy on the attacker's own
//      balance), Solidity 0.8 underflow prevents exploitation. Combined with the
//      missing access-control bug, it enables the forced-withdrawal griefing
//      described above. The pattern should be fixed regardless.
//
// ─────────────────────────────────────────────────────────────────────────────

/// @notice Attacker contract used to demonstrate the HONEST behavior.
///         Funded correctly: vm.prank ensures the attacker pays its own deposit,
///         so its raw ETH balance is 0 before the attack begins.
contract HonestAttacker {
    VulnerableVault public vault;

    constructor(VulnerableVault _vault) {
        vault = _vault;
    }

    /// @notice Deposit is called via vm.prank(address(this)) in setUp,
    ///         so msg.value comes from this contract's own balance.
    function deposit() external payable {
        vault.deposit{value: msg.value}();
    }

    /// @notice Attempt the "combined" attack: withdraw own deposit (triggers receive).
    ///         alice parameter is unused here — her funds go to her address, not here.
    function attack(address payable /*alice*/) external {
        vault.withdraw(payable(address(this)), 1 ether);
        // Note: alice's funds are sent to alice (not to this contract).
        // This is griefing, not theft.
    }

    receive() external payable {
        // Re-entry point: attacker's own balance not yet decremented.
        // We can attempt to withdraw alice's funds — but they go TO alice, not here.
        // No profit accrues to this contract from alice's withdrawal.
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}

/// @notice Third-party griefing contract: demonstrates forced-withdrawal DoS.
///         A griefing contract that rejects ETH, causing vault.withdraw to revert
///         and permanently locking the griefing contract's vault balance.
contract ETHRejectingDepositor {
    VulnerableVault public vault;

    constructor(VulnerableVault _vault) {
        vault = _vault;
    }

    function deposit() external payable {
        vault.deposit{value: msg.value}();
    }

    /// @notice Explicitly rejects all ETH transfers.
    receive() external payable {
        revert("I reject ETH");
    }

    function getVaultBalance() external view returns (uint256) {
        return vault.balances(address(this));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE
// ─────────────────────────────────────────────────────────────────────────────

contract ArgusReentrancyTruthTest is Test {
    VulnerableVault public vault;
    address payable alice;

    function setUp() public {
        vault = new VulnerableVault();
        alice = payable(makeAddr("alice"));

        // Alice deposits 10 ETH
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 10 ether}();

        assertEq(address(vault).balance, 10 ether, "setUp: vault holds 10 ETH");
        assertEq(vault.balances(alice), 10 ether, "setUp: alice credited 10 ETH");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: NO THEFT — attacker recovers only its own deposit, zero net gain
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Proves that an attacker cannot steal ETH from the vault.
    ///
    ///   Funding discipline:
    ///     - vm.deal(attacker, 1 ether) gives the attacker contract 1 ETH.
    ///     - vm.prank(attacker) + attacker.deposit{value:1 ether}() ensures the
    ///       attacker's OWN balance pays the deposit. After deposit, attacker
    ///       raw balance == 0 and balances[attacker] == 1 ETH.
    ///     - This eliminates the un-deposited leftover that inflated the original test.
    ///
    ///   After attack():
    ///     - Vault sends 1 ETH to attacker (its own deposit back).
    ///     - balances[attacker] decremented to 0 on unwind (safe, no underflow).
    ///     - attackerNetVaultGain = ETH received from vault - ETH deposited = 0.
    ///
    ///   Conclusion: THEFT IS IMPOSSIBLE. Conservation holds.
    function testNoTheft_AttackerRecoverOnlyOwnDeposit() public {
        // Deploy attacker
        HonestAttacker attacker = new HonestAttacker(vault);

        // Fund attacker with exactly 1 ETH and deposit it — no leftover
        vm.deal(address(attacker), 1 ether);
        // vm.prank makes the attacker contract itself the msg.sender for the next call
        vm.prank(address(attacker));
        // We call deposit() directly on the vault so msg.sender == attacker
        vault.deposit{value: 1 ether}();

        // Verify: attacker raw balance is now 0 (all ETH deposited into vault)
        assertEq(address(attacker).balance, 0, "Pre-attack: attacker raw balance == 0 (no leftover)");
        assertEq(vault.balances(address(attacker)), 1 ether, "Pre-attack: attacker vault credit == 1 ETH");
        assertEq(address(vault).balance, 11 ether, "Pre-attack: vault holds 11 ETH");

        console2.log("=== NO-THEFT PROOF ===");
        console2.log("Pre-attack attacker raw balance:  ", address(attacker).balance);
        console2.log("Pre-attack attacker vault credit: ", vault.balances(address(attacker)));
        console2.log("Pre-attack vault ETH:             ", address(vault).balance);

        // Execute attack: withdraw(attacker, 1 ETH)
        // receive() fires but does nothing profitable (alice's ETH goes to alice, not attacker)
        attacker.attack(alice);

        console2.log("Post-attack attacker raw balance: ", address(attacker).balance);
        console2.log("Post-attack attacker vault credit:", vault.balances(address(attacker)));
        console2.log("Post-attack vault ETH:            ", address(vault).balance);

        // Attacker received exactly 1 ETH from vault (its own deposit back)
        uint256 attackerETHReceived = address(attacker).balance; // == 1 ETH
        uint256 attackerETHDeposited = 1 ether;
        int256 attackerNetVaultGain = int256(attackerETHReceived) - int256(attackerETHDeposited);

        console2.log("Attacker ETH received from vault: ", attackerETHReceived);
        console2.log("Attacker ETH deposited into vault:", attackerETHDeposited);
        console2.log("Attacker NET vault gain (signed): ");
        // Log as int via cast
        if (attackerNetVaultGain >= 0) {
            console2.log("  +", uint256(attackerNetVaultGain));
        } else {
            console2.log("  -", uint256(-attackerNetVaultGain));
        }

        // CORE ASSERTION: net gain is zero — no theft
        assertEq(attackerNetVaultGain, 0, "THEFT IMPOSSIBLE: attacker net vault gain == 0");

        // Attacker vault credit zeroed (single safe decrement on unwind)
        assertEq(vault.balances(address(attacker)), 0, "Attacker vault credit zeroed");

        // Alice's funds untouched (attacker's receive() did nothing to alice in this test)
        assertEq(vault.balances(alice), 10 ether, "Alice vault credit unchanged");
        assertEq(alice.balance, 0, "Alice raw balance unchanged (no forced withdrawal)");

        console2.log("CONFIRMED: attackerNetVaultGain == 0. Theft is impossible.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: FORCED-WITHDRAWAL GRIEFING — third party force-withdraws victim's
    //         balance TO the victim (not to the attacker)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Proves the real impact: forced-withdrawal griefing.
    ///
    ///   A third party (griefingCaller) calls withdraw(alice, 1 ETH).
    ///   Because there is no msg.sender check, this succeeds.
    ///   Alice's ETH is sent to alice's address — NOT to the griefingCaller.
    ///   The griefingCaller gains nothing. Alice's funds are returned to her.
    ///
    ///   This is griefing / forced action, not theft.
    function testForcedWithdrawal_ETHGoesToVictimNotCaller() public {
        address griefingCaller = makeAddr("griefingCaller");

        console2.log("=== FORCED-WITHDRAWAL GRIEFING PROOF ===");
        console2.log("Pre-grief alice vault credit:     ", vault.balances(alice));
        console2.log("Pre-grief alice raw balance:      ", alice.balance);
        console2.log("Pre-grief griefingCaller balance: ", griefingCaller.balance);

        // griefingCaller force-withdraws alice's 1 ETH — to alice's address
        vm.prank(griefingCaller);
        vault.withdraw(alice, 1 ether);

        console2.log("Post-grief alice vault credit:    ", vault.balances(alice));
        console2.log("Post-grief alice raw balance:     ", alice.balance);
        console2.log("Post-grief griefingCaller balance:", griefingCaller.balance);

        // Alice received her own ETH back
        assertEq(alice.balance, 1 ether, "Alice received her own ETH (not stolen)");
        assertEq(vault.balances(alice), 9 ether, "Alice vault credit decremented by 1 ETH");

        // griefingCaller gained NOTHING
        assertEq(griefingCaller.balance, 0, "griefingCaller gained 0 ETH - not theft");

        console2.log("CONFIRMED: forced withdrawal sends ETH to victim, not caller.");
        console2.log("This is griefing/DoS, not theft.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: FORCED-WITHDRAWAL DoS — victim is ETH-rejecting contract
    //         => funds permanently locked
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Proves the DoS variant: if the victim is a contract that rejects ETH,
    ///         a third party calling withdraw(victim, amount) causes the tx to revert,
    ///         and the victim's funds remain locked in the vault indefinitely.
    ///
    ///   This is the most severe reachable impact: permanent fund lock for
    ///   contract depositors that reject ETH.
    function testForcedWithdrawal_DoS_ETHRejectingVictim() public {
        // Deploy an ETH-rejecting depositor
        ETHRejectingDepositor victim = new ETHRejectingDepositor(vault);

        // Victim deposits 5 ETH into the vault
        vm.deal(address(victim), 5 ether);
        vm.prank(address(victim));
        vault.deposit{value: 5 ether}();

        assertEq(vault.balances(address(victim)), 5 ether, "Victim credited 5 ETH");
        assertEq(address(vault).balance, 15 ether, "Vault holds 15 ETH");

        console2.log("=== FORCED-WITHDRAWAL DoS PROOF ===");
        console2.log("Victim vault credit:  ", vault.balances(address(victim)));
        console2.log("Victim raw balance:   ", address(victim).balance);

        // A third party tries to force-withdraw victim's ETH.
        // The vault calls victim.receive() which reverts with "I reject ETH".
        // The entire withdraw() call reverts.
        address griefingCaller = makeAddr("griefingCaller");
        vm.prank(griefingCaller);
        vm.expectRevert(); // vault.withdraw reverts because victim rejects ETH
        vault.withdraw(payable(address(victim)), 1 ether);

        // Victim's funds remain locked — they cannot withdraw themselves either
        // because their own receive() rejects ETH.
        // (In this vault, the victim would need to call withdraw(victim, amount)
        //  themselves, which also reverts because their receive() rejects ETH.)
        vm.prank(address(victim));
        vm.expectRevert(); // victim cannot withdraw their own funds either
        vault.withdraw(payable(address(victim)), 1 ether);

        // Funds permanently locked
        assertEq(vault.balances(address(victim)), 5 ether, "Victim vault credit unchanged - funds locked");
        assertEq(address(victim).balance, 0, "Victim raw balance unchanged - ETH stuck in vault");

        console2.log("CONFIRMED: ETH-rejecting contract depositor has funds permanently locked.");
        console2.log("This is the real DoS impact of the missing access control + CEI violation.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: UNDERFLOW GUARD — pure reentrancy cannot over-extract
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Proves that Solidity 0.8 checked arithmetic prevents pure reentrancy
    ///         from extracting more than the deposited amount.
    ///
    ///   A reentrant attacker that tries to call withdraw(self, 1 ETH) recursively
    ///   will accumulate N+1 pending `balances[self] -= 1 ETH` decrements on the
    ///   unwind stack. When the (deposited/amount + 1)th decrement executes,
    ///   balances[self] underflows and the ENTIRE transaction reverts.
    ///   No ETH is extracted. The vault is safe against pure reentrancy.
    function testUnderflowGuard_PureReentrancyReverts() public {
        // Deploy a purely reentrant attacker (re-enters on itself)
        PureReentrantAttacker reentrant = new PureReentrantAttacker(vault);

        // Fund and deposit 1 ETH
        vm.deal(address(reentrant), 1 ether);
        vm.prank(address(reentrant));
        vault.deposit{value: 1 ether}();

        assertEq(vault.balances(address(reentrant)), 1 ether, "Reentrant attacker credited 1 ETH");
        assertEq(address(reentrant).balance, 0, "Reentrant attacker raw balance == 0 before attack");

        console2.log("=== UNDERFLOW GUARD PROOF ===");
        console2.log("Pre-attack reentrant vault credit:", vault.balances(address(reentrant)));

        // The attack MUST revert due to underflow on the unwind stack
        vm.expectRevert();
        reentrant.attack();

        // State is unchanged — no ETH extracted
        assertEq(vault.balances(address(reentrant)), 1 ether, "Vault credit unchanged after revert");
        assertEq(address(reentrant).balance, 0, "Reentrant attacker extracted 0 ETH");
        assertEq(address(vault).balance, 11 ether, "Vault balance unchanged after revert");

        console2.log("CONFIRMED: pure reentrancy reverts due to Solidity 0.8 underflow guard.");
        console2.log("No ETH extracted. Vault safe against pure reentrancy.");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Pure reentrant attacker (re-enters on its own balance)
// ─────────────────────────────────────────────────────────────────────────────

/// @notice Attempts recursive reentrancy on its own balance.
///         Will revert on unwind due to Solidity 0.8 underflow.
contract PureReentrantAttacker {
    VulnerableVault public vault;
    uint256 public depth;

    constructor(VulnerableVault _vault) {
        vault = _vault;
    }

    function attack() external {
        depth = 0;
        vault.withdraw(payable(address(this)), 1 ether);
    }

    receive() external payable {
        depth++;
        if (depth < 3) {
            // Try to re-enter: withdraw own balance again (stale check passes)
            vault.withdraw(payable(address(this)), 1 ether);
        }
        // On unwind: balances[this] -= 1 ether fires depth+1 times.
        // With only 1 ETH deposited, the 2nd decrement underflows → revert.
    }
}
