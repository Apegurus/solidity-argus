---
name: amm-dex
description: AMM and DEX security patterns covering pricing, LP accounting, MEV, and swap invariants.
category: protocol-pattern
source_url: https://github.com/DeFiFoFum/fofum-solidity-skills
source_license: MIT
imported_at: "2025-01-15T00:00:00Z"
---
<!-- Source: DeFiFoFum/fofum-solidity-skills (MIT) -->

# AMM (Automated Market Maker) Security Guide

## Overview

AMMs (Uniswap, Curve, Balancer) enable permissionless token swaps via liquidity pools. Core security concerns: price manipulation, MEV, impermanent loss, and LP token accounting.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         AMM POOL                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   x * y = k (Constant Product)                              │
│                                                             │
│   ┌─────────┐         ┌─────────┐                          │
│   │ Token A │ ◄─────► │ Token B │                          │
│   │ Reserve │         │ Reserve │                          │
│   └─────────┘         └─────────┘                          │
│        ▲                   ▲                                │
│        │                   │                                │
│   ┌─────────────────────────────┐                          │
│   │      LP Token Holders       │                          │
│   └─────────────────────────────┘                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Critical Security Areas

### 1. Price Manipulation

**Attack Vectors:**
- Flash loan price manipulation
- Sandwich attacks
- JIT (Just-In-Time) liquidity

**Checklist:**
- [ ] Is spot price used for anything critical? (Don't!)
- [ ] Are there TWAP implementations? Are windows sufficient?
- [ ] Can price be moved significantly in one transaction?
- [ ] Is slippage protection enforced?

```solidity
// VULNERABLE: Spot price for external use
function getPrice() external view returns (uint256) {
    return reserve1 * 1e18 / reserve0;  // Manipulatable!
}

// SECURE: Accumulator-based TWAP
function updateTWAP() internal {
    uint32 timeElapsed = block.timestamp - lastUpdate;
    if (timeElapsed > 0) {
        priceAccumulator += getSpotPrice() * timeElapsed;
        lastUpdate = block.timestamp;
    }
}
```

### 2. Slippage & MEV

**Attack Vectors:**
- User sets 0 slippage tolerance
- Sandwich attacks when slippage is high
- Deadline not enforced

**Checklist:**
- [ ] Is minAmountOut enforced?
- [ ] Is deadline parameter checked?
- [ ] Are there reasonable slippage bounds?
- [ ] Is there MEV protection guidance for users?

```solidity
// VULNERABLE: No deadline check
function swap(uint256 amountIn, uint256 minAmountOut) external {
    // Missing deadline check - tx can be held and executed later
}

// SECURE
function swap(
    uint256 amountIn, 
    uint256 minAmountOut,
    uint256 deadline
) external {
    require(block.timestamp <= deadline, "Expired");
    // ...
    require(amountOut >= minAmountOut, "Slippage");
}
```

### 3. LP Token Accounting

**Attack Vectors:**
- First depositor inflation attack
- LP token value manipulation
- Donation attacks

**Checklist:**
- [ ] Is first LP protected from inflation attack?
- [ ] Are LP tokens calculated correctly with proper rounding?
- [ ] Can direct token transfers manipulate LP value?
- [ ] Is minimum liquidity locked (Uniswap pattern)?

```solidity
// Uniswap V2 first deposit protection
uint256 public constant MINIMUM_LIQUIDITY = 1000;

function mint() external returns (uint256 liquidity) {
    uint256 _totalSupply = totalSupply;
    if (_totalSupply == 0) {
        liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
        _mint(address(0), MINIMUM_LIQUIDITY);  // Lock minimum
    } else {
        liquidity = Math.min(
            amount0 * _totalSupply / _reserve0,
            amount1 * _totalSupply / _reserve1
        );
    }
}
```

### 4. Swap Calculations

**Attack Vectors:**
- Rounding errors favoring trader
- Fee bypass
- Incorrect constant product maintenance

**Checklist:**
- [ ] Is k always maintained or increasing (k_after ≥ k_before)?
- [ ] Are fees correctly deducted?
- [ ] Does rounding favor the pool?
- [ ] Are there precision issues with small amounts?

```solidity
// VULNERABLE: k can decrease due to rounding
function swap(uint256 amountIn, uint256 amountOut) external {
    // ... transfer tokens ...
    require(reserve0 * reserve1 >= k, "Invalid k");  // Should be >=
}
```

### 5. Reentrancy in Swaps

**Attack Vectors:**
- Callback reentrancy (flash swaps)
- ERC777/hooks during transfer

**Checklist:**
- [ ] Is reentrancy guard in place?
- [ ] Are state updates before external calls?
- [ ] Are callbacks properly restricted?
- [ ] Is there ERC777 token support? If so, is it safe?

---

## AMM-Specific Vulnerabilities

### Curve: Read-Only Reentrancy

```solidity
// Curve's virtual_price can be manipulated during reentrancy
// Attack: Enter pool → in callback, read virtual_price → it's wrong

// VULNERABLE: Reading Curve virtual_price during callback
function deposit(uint256 amount) external {
    uint256 price = curvePool.get_virtual_price();  // Can be manipulated
    uint256 value = amount * price / 1e18;
}
```

### Uniswap V3: Concentrated Liquidity

**Additional concerns:**
- Tick manipulation
- Position NFT security
- Fee calculation across ticks

### Balancer: Weighted Pools

**Additional concerns:**
- Weight manipulation in managed pools
- Complex math (power functions)
- Multiple token interactions

---

## Testing Checklist

### Unit Tests
- [ ] Swap calculations match expected output
- [ ] LP mint/burn accounting
- [ ] Fee collection accurate
- [ ] Slippage enforcement

### Integration Tests
- [ ] Multi-hop swaps
- [ ] Flash swap callbacks
- [ ] Oracle integrations

### Invariant Tests
- [ ] k_after ≥ k_before (constant product)
- [ ] Sum of LP tokens = totalSupply
- [ ] Reserves match actual balances
- [ ] No tokens created from nothing

### Attack Simulations
- [ ] Sandwich attack simulation
- [ ] Flash loan manipulation
- [ ] First depositor attack

---

## References

- [Uniswap V2 Core](https://github.com/Uniswap/v2-core)
- [Uniswap V3 Security](https://github.com/Uniswap/v3-core/tree/main/audits)
- [Curve Read-Only Reentrancy](https://chainsecurity.com/heartbeats/curve-lp-oracle-manipulation/)
- [Balancer V2 Security](https://docs.balancer.fi/concepts/security/audits.html)
