---
name: dao-governance
description: Governance security patterns for voting, timelocks, proposal execution, and quorum safety.
category: protocol-pattern
---
<!-- Source: DeFiFoFum/fofum-solidity-skills (MIT) -->

# Governance Protocol Security Guide

## Overview

Governance protocols enable token-based decision making. Core security concerns: voting manipulation, flash loan attacks, proposal execution, and timelock bypasses.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GOVERNANCE SYSTEM                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   PROPOSE      →      VOTE        →      EXECUTE            │
│   ────────            ────               ───────            │
│   Create proposal     Cast votes         After timelock     │
│   Meet threshold      Snapshot power     Run actions        │
│                                                             │
│   ┌──────────────────────────────────────────────────────┐  │
│   │                    TIMELOCK                          │  │
│   │   Queue → Wait (e.g., 2 days) → Execute              │  │
│   └──────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Critical Security Areas

### 1. Flash Loan Voting

**Attack Vectors:**
- Borrow tokens, vote, return in same block
- Acquire governance majority temporarily

**Checklist:**
- [ ] Is voting power snapshot-based (past block)?
- [ ] Is there delay between proposal and voting start?
- [ ] Can voting power be acquired and used in same transaction?

```solidity
// VULNERABLE: Current balance for voting
function vote(uint256 proposalId, bool support) external {
    uint256 votes = token.balanceOf(msg.sender);  // Flashloanable!
    _castVote(proposalId, msg.sender, support, votes);
}

// SECURE: Historical balance (ERC20Votes)
function vote(uint256 proposalId, bool support) external {
    uint256 votes = token.getPastVotes(
        msg.sender, 
        proposals[proposalId].snapshot  // Block when proposal created
    );
    _castVote(proposalId, msg.sender, support, votes);
}
```

### 2. Proposal Execution

**Attack Vectors:**
- Malicious calldata
- Reentrancy during execution
- State manipulation between queue and execute

**Checklist:**
- [ ] Is there a timelock between queue and execute?
- [ ] Are proposal actions validated?
- [ ] Is there reentrancy protection?
- [ ] Can proposal be executed multiple times?

```solidity
// VULNERABLE: No execution state check
function execute(uint256 proposalId) external {
    Proposal storage p = proposals[proposalId];
    require(p.state == ProposalState.Succeeded, "Not succeeded");
    // Missing: p.state = ProposalState.Executed;
    
    for (uint256 i; i < p.targets.length; i++) {
        p.targets[i].call(p.calldatas[i]);
    }
    // Can be called again!
}
```

### 3. Quorum & Threshold Manipulation

**Attack Vectors:**
- Lowering quorum via governance
- Manipulating total supply for quorum calculation
- Emergency actions without proper threshold

**Checklist:**
- [ ] Is quorum based on total supply or snapshot?
- [ ] Can quorum/threshold be changed to dangerous levels?
- [ ] Are there bounds on governance parameters?
- [ ] Is total supply snapshot-based?

```solidity
// VULNERABLE: Quorum based on current supply
function quorum() public view returns (uint256) {
    return token.totalSupply() * 4 / 100;  // Can be manipulated
}

// SECURE: Quorum at snapshot
function quorum(uint256 blockNumber) public view returns (uint256) {
    return token.getPastTotalSupply(blockNumber) * 4 / 100;
}
```

### 4. Timelock Security

**Attack Vectors:**
- Bypassing timelock via emergency functions
- Timelock too short for community response
- Admin can cancel queued proposals

**Checklist:**
- [ ] Is timelock long enough (24h minimum, 48h+ recommended)?
- [ ] Are emergency bypasses properly restricted?
- [ ] Can queued proposals be canceled maliciously?
- [ ] Is there grace period after timelock?

```solidity
uint256 public constant MINIMUM_DELAY = 2 days;
uint256 public constant MAXIMUM_DELAY = 30 days;
uint256 public constant GRACE_PERIOD = 14 days;

function setDelay(uint256 delay) external {
    require(msg.sender == address(this), "Only self");
    require(delay >= MINIMUM_DELAY, "Too short");
    require(delay <= MAXIMUM_DELAY, "Too long");
    delay_ = delay;
}
```

### 5. Delegation & Voting Power

**Attack Vectors:**
- Double voting via delegation
- Delegation to zero address
- Vote power not updating on transfer

**Checklist:**
- [ ] Is delegation handled correctly (no double counting)?
- [ ] Does voting power update on token transfer?
- [ ] Can users delegate to themselves?
- [ ] Is there delegation chain/depth limit?

---

## Common Vulnerabilities

### Beanstalk Attack Pattern

```solidity
// Attack flow:
// 1. Flash loan governance tokens
// 2. Create proposal (if allowed in same tx)
// 3. Vote with flash-loaned tokens
// 4. Execute proposal immediately (no timelock)
// 5. Proposal drains funds
// 6. Return flash loan

// ALL of these should fail:
// - Snapshot should be from past block
// - Voting delay should prevent same-block voting
// - Timelock should delay execution
```

### Proposal Front-Running

```solidity
// VULNERABLE: Proposal can be front-run
function propose(
    address[] memory targets,
    bytes[] memory calldatas,
    string memory description
) public returns (uint256) {
    uint256 proposalId = hashProposal(targets, calldatas, keccak256(bytes(description)));
    // Attacker can front-run with same proposal, different description
}
```

### Unsafe Delegatecall in Execution

```solidity
// VULNERABLE: delegatecall in governor
function execute(...) external {
    for (uint i; i < targets.length; i++) {
        (bool success,) = targets[i].delegatecall(calldatas[i]);
        // delegatecall in governance = CRITICAL RISK
    }
}
```

---

## Secure Patterns

### OpenZeppelin Governor

```solidity
import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

contract SecureGovernor is Governor, GovernorVotes, GovernorTimelockControl {
    function votingDelay() public pure override returns (uint256) {
        return 1 days;  // Time before voting starts
    }
    
    function votingPeriod() public pure override returns (uint256) {
        return 1 weeks;  // Voting duration
    }
}
```

### Vote Escrow (veToken)

```solidity
// Lock tokens for voting power (Curve model)
// Longer lock = more voting power
// Prevents flash loan attacks by requiring locked tokens

struct LockedBalance {
    uint256 amount;
    uint256 unlockTime;
}

function votingPower(address user) public view returns (uint256) {
    LockedBalance memory lock = locked[user];
    if (lock.unlockTime <= block.timestamp) return 0;
    
    uint256 timeLeft = lock.unlockTime - block.timestamp;
    return lock.amount * timeLeft / MAX_LOCK_TIME;
}
```

---

## Testing Checklist

### Unit Tests
- [ ] Proposal creation with correct threshold
- [ ] Voting with snapshot balances
- [ ] Quorum calculation
- [ ] Execution after timelock

### Integration Tests
- [ ] Full proposal lifecycle
- [ ] Delegation and vote casting
- [ ] Multiple proposals concurrent

### Attack Tests
- [ ] Flash loan voting attempt
- [ ] Same-block propose + vote
- [ ] Proposal re-execution attempt
- [ ] Quorum manipulation

### Invariant Tests
- [ ] Total votes ≤ total voting power at snapshot
- [ ] Executed proposals can't re-execute
- [ ] Timelock always enforced

---

## References

- [OpenZeppelin Governor](https://docs.openzeppelin.com/contracts/governance)
- [Compound Governor Bravo](https://github.com/compound-finance/compound-protocol/blob/master/contracts/Governance/GovernorBravoDelegate.sol)
- [Beanstalk Exploit Analysis](https://rekt.news/beanstalk-rekt/)
- [Nouns DAO Fork](https://github.com/nounsDAO/nouns-monorepo)
