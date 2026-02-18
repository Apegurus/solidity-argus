---
name: staking-vesting
description: Staking security guidance for reward accounting, lock periods, timing attacks, and withdrawals.
---

<!-- Source: DeFiFoFum/fofum-solidity-skills (MIT) -->

# Staking Protocol Security Guide

## Overview

Staking protocols lock tokens to earn rewards. Core security concerns: reward calculation, timing attacks, withdrawal delays, and token accounting.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     STAKING PROTOCOL                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   STAKE            EARN              UNSTAKE                │
│   ──────           ────              ───────                │
│   Lock tokens  →   Accrue rewards  →  Withdraw + rewards    │
│                                                             │
│   rewardPerToken = totalRewards / totalStaked / time        │
│                                                             │
│   userReward = (rewardPerToken - userRewardPaid) * balance  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Critical Security Areas

### 1. Reward Calculation

**Attack Vectors:**
- Claim rewards multiple times
- Manipulation of rewardPerToken
- Precision loss in reward math

**Checklist:**
- [ ] Is rewardPerTokenStored updated before any balance changes?
- [ ] Is userRewardPerTokenPaid updated when claiming?
- [ ] Can rewards be claimed multiple times for same period?
- [ ] Is precision sufficient (multiply before divide)?

```solidity
// Standard Synthetix staking pattern
uint256 public rewardPerTokenStored;
mapping(address => uint256) public userRewardPerTokenPaid;
mapping(address => uint256) public rewards;

modifier updateReward(address account) {
    rewardPerTokenStored = rewardPerToken();
    lastUpdateTime = block.timestamp;
    if (account != address(0)) {
        rewards[account] = earned(account);
        userRewardPerTokenPaid[account] = rewardPerTokenStored;
    }
    _;
}

function earned(address account) public view returns (uint256) {
    return balances[account] * 
        (rewardPerToken() - userRewardPerTokenPaid[account]) / 1e18 +
        rewards[account];
}
```

### 2. Deposit/Withdrawal Timing

**Attack Vectors:**
- Stake just before rewards, unstake right after
- Flash loan staking
- MEV on reward distribution

**Checklist:**
- [ ] Is there a minimum stake duration?
- [ ] Are rewards distributed over time (not lump sum)?
- [ ] Can someone stake in same block as reward distribution?
- [ ] Is there unstaking delay/cooldown?

```solidity
// VULNERABLE: Instant stake and claim
function distributeReward(uint256 amount) external {
    rewardToken.transferFrom(msg.sender, address(this), amount);
    rewardPerTokenStored += amount * 1e18 / totalStaked;
    // Flash staker can stake before this, claim after
}

// SECURE: Drip rewards over time
function notifyRewardAmount(uint256 reward) external {
    if (block.timestamp >= periodFinish) {
        rewardRate = reward / DURATION;
    } else {
        uint256 remaining = periodFinish - block.timestamp;
        uint256 leftover = remaining * rewardRate;
        rewardRate = (reward + leftover) / DURATION;
    }
    lastUpdateTime = block.timestamp;
    periodFinish = block.timestamp + DURATION;
}
```

### 3. Token Accounting

**Attack Vectors:**
- Donation attacks (direct transfer)
- Rebase token issues
- Fee-on-transfer tokens

**Checklist:**
- [ ] Are direct token transfers handled?
- [ ] Is actual received amount checked (fee-on-transfer)?
- [ ] Are rebase tokens supported? If so, how?
- [ ] Is totalStaked always equal to sum of balances?

```solidity
// VULNERABLE: Assumes full amount received
function stake(uint256 amount) external {
    stakingToken.transferFrom(msg.sender, address(this), amount);
    balances[msg.sender] += amount;  // Wrong for fee-on-transfer!
    totalStaked += amount;
}

// SECURE: Check actual amount received
function stake(uint256 amount) external {
    uint256 balanceBefore = stakingToken.balanceOf(address(this));
    stakingToken.transferFrom(msg.sender, address(this), amount);
    uint256 received = stakingToken.balanceOf(address(this)) - balanceBefore;
    
    balances[msg.sender] += received;
    totalStaked += received;
}
```

### 4. Lock/Unlock Mechanisms

**Attack Vectors:**
- Bypassing lock periods
- Lock period manipulation
- Emergency withdrawal exploits

**Checklist:**
- [ ] Is lock timestamp immutable after staking?
- [ ] Can partial unlocks bypass full lock?
- [ ] Is emergency withdrawal penalized appropriately?
- [ ] Are there reentrancy risks in unlock?

```solidity
// VULNERABLE: Lock can be extended/reset incorrectly
function stake(uint256 amount) external {
    balances[msg.sender] += amount;
    lockEnd[msg.sender] = block.timestamp + LOCK_PERIOD;  // Resets lock!
}

// SECURE: Don't reset existing locks
function stake(uint256 amount) external {
    balances[msg.sender] += amount;
    if (lockEnd[msg.sender] < block.timestamp) {
        lockEnd[msg.sender] = block.timestamp + LOCK_PERIOD;
    }
    // Existing lock preserved
}
```

### 5. Reward Token Handling

**Attack Vectors:**
- Same token for stake and reward (inflation)
- Reward token donation manipulation
- Insufficient reward balance

**Checklist:**
- [ ] Is stake token different from reward token?
- [ ] Is there sufficient reward balance for all claims?
- [ ] Can reward distribution be griefed?
- [ ] Are multiple reward tokens handled correctly?

---

## Common Vulnerabilities

### Reentrancy in Claim

```solidity
// VULNERABLE: External call before state update
function claim() external {
    uint256 reward = earned(msg.sender);
    rewardToken.transfer(msg.sender, reward);  // External call first
    rewards[msg.sender] = 0;  // State update after
}
```

### Division Before Multiplication

```solidity
// VULNERABLE: Precision loss
function rewardPerToken() public view returns (uint256) {
    if (totalStaked == 0) return rewardPerTokenStored;
    return rewardPerTokenStored + 
        (rewardRate / totalStaked) * (block.timestamp - lastUpdate);  // Wrong order!
}

// SECURE
function rewardPerToken() public view returns (uint256) {
    if (totalStaked == 0) return rewardPerTokenStored;
    return rewardPerTokenStored + 
        rewardRate * (block.timestamp - lastUpdate) * 1e18 / totalStaked;
}
```

---

## Testing Checklist

### Unit Tests
- [ ] Stake/unstake accounting
- [ ] Reward accrual over time
- [ ] Multiple stakers, proportional rewards
- [ ] Claim resets user state correctly

### Integration Tests
- [ ] Multiple reward periods
- [ ] Stakers joining mid-period
- [ ] Edge cases (first staker, last staker)

### Invariant Tests
- [ ] totalStaked = sum(balances)
- [ ] Rewards claimable ≤ reward balance
- [ ] No user can claim more than entitled

### Attack Tests
- [ ] Flash stake attack
- [ ] Double claim attempt
- [ ] Donation manipulation

---

## References

- [Synthetix Staking Rewards](https://github.com/Synthetixio/synthetix/blob/develop/contracts/StakingRewards.sol)
- [Convex Staking](https://github.com/convex-eth/platform)
- [MasterChef (SushiSwap)](https://github.com/sushiswap/sushiswap/blob/master/contracts/MasterChef.sol)
