---
name: lending-borrowing
description: Security review framework for lending and borrowing systems including liquidations and accounting.
---
<!-- Source: DeFiFoFum/fofum-solidity-skills (MIT) -->

# Lending Protocol Security Guide

## Overview

Lending protocols (Aave, Compound, Morpho) enable collateralized borrowing. Core security concerns: liquidation logic, interest accrual, oracle reliance, and collateral management.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      LENDING PROTOCOL                       │
├─────────────────────────────────────────────────────────────┤
│  SUPPLY          │  BORROW           │  LIQUIDATE          │
│  ─────────       │  ─────────        │  ─────────          │
│  Deposit asset   │  Lock collateral  │  Seize collateral   │
│  Receive shares  │  Receive asset    │  Repay debt         │
│  Earn interest   │  Pay interest     │  Get bonus          │
├─────────────────────────────────────────────────────────────┤
│                      RISK ENGINE                            │
│  Health Factor = Collateral Value / Borrowed Value          │
│  If HF < 1: Position is liquidatable                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Critical Security Areas

### 1. Liquidation Logic

**Attack Vectors:**
- Self-liquidation for profit
- Liquidation front-running
- Incorrect health factor calculation
- Liquidation bonus manipulation

**Checklist:**
- [ ] Can users self-liquidate profitably?
- [ ] Is health factor calculation correct with all decimal handling?
- [ ] Is liquidation bonus reasonable (not exploitable)?
- [ ] Are partial liquidations handled correctly?
- [ ] Can dust amounts block liquidation?

```solidity
// VULNERABLE: No self-liquidation check
function liquidate(address borrower, uint256 amount) external {
    require(getHealthFactor(borrower) < 1e18, "Healthy");
    // Missing: require(msg.sender != borrower, "No self-liquidation");
}
```

### 2. Interest Rate Model

**Attack Vectors:**
- Interest rate manipulation via large deposits/borrows
- Accrual timing exploits
- Compound interest calculation errors

**Checklist:**
- [ ] Is interest accrued before all operations?
- [ ] Are utilization rate calculations correct?
- [ ] Can interest rate be manipulated within a transaction?
- [ ] Are there bounds on interest rates?

```solidity
// VULNERABLE: Interest not accrued before operation
function withdraw(uint256 amount) external {
    // Missing: accrueInterest();
    uint256 shares = amount * totalShares / totalAssets;
    _burn(msg.sender, shares);
}

// SECURE
function withdraw(uint256 amount) external {
    accrueInterest();  // Always accrue first
    uint256 shares = amount * totalShares / totalAssets;
    _burn(msg.sender, shares);
}
```

### 3. Oracle Dependency

**Attack Vectors:**
- Price oracle manipulation
- Stale price exploitation
- Flash loan + oracle attack

**Checklist:**
- [ ] Are oracle prices validated for freshness?
- [ ] Are price bounds checked?
- [ ] Can prices be manipulated via flash loans?
- [ ] Is there circuit breaker for price anomalies?

See: [oracle.md](./exploits/oracle.md)

### 4. Collateral Management

**Attack Vectors:**
- Depositing worthless collateral
- Collateral factor manipulation
- Bad debt accumulation

**Checklist:**
- [ ] Are collateral factors appropriate for asset volatility?
- [ ] Is there a whitelist for supported collateral?
- [ ] How is bad debt handled?
- [ ] Can users withdraw collateral below safe threshold?

### 5. Share/Asset Accounting (ERC4626)

**Attack Vectors:**
- Inflation attacks on first deposit
- Rounding direction exploitation
- Donation attacks

**Checklist:**
- [ ] Is first depositor protected from inflation attack?
- [ ] Does rounding favor the protocol (round down on mint, up on burn)?
- [ ] Are direct asset transfers (donations) handled?
- [ ] Is totalAssets always ≥ sum of deposits?

```solidity
// Inflation attack protection
function deposit(uint256 assets) external returns (uint256 shares) {
    require(assets >= MINIMUM_DEPOSIT, "Below minimum");
    shares = totalSupply == 0 
        ? assets  // First deposit
        : assets * totalSupply / totalAssets;
    require(shares > 0, "Zero shares");
    // ...
}
```

---

## Common Vulnerabilities

### Reentrancy in Lending

```solidity
// VULNERABLE: CEI violation
function borrow(uint256 amount) external {
    require(checkCollateral(msg.sender, amount), "Undercollateralized");
    token.transfer(msg.sender, amount);  // External call before state update
    borrowBalances[msg.sender] += amount;  // State update after
}
```

### Incorrect Decimal Handling

```solidity
// VULNERABLE: Assumes all tokens have 18 decimals
function calculateValue(address token, uint256 amount) public view returns (uint256) {
    uint256 price = oracle.getPrice(token);  // Price in USD with 8 decimals
    return amount * price / 1e8;  // Wrong if token isn't 18 decimals!
}

// SECURE
function calculateValue(address token, uint256 amount) public view returns (uint256) {
    uint256 price = oracle.getPrice(token);
    uint8 decimals = IERC20Metadata(token).decimals();
    return amount * price / (10 ** decimals);
}
```

### Liquidation Threshold Edge Cases

```solidity
// VULNERABLE: Dust prevents liquidation
function liquidate(address borrower, uint256 amount) external {
    uint256 debt = borrowBalances[borrower];
    require(amount <= debt, "Too much");
    // If debt = 100 wei and minimum repay = 100 wei, can't liquidate
}
```

---

## Testing Checklist

### Unit Tests
- [ ] Deposit/withdraw accounting correct
- [ ] Borrow/repay accounting correct
- [ ] Interest accrual over time
- [ ] Liquidation triggers at correct threshold
- [ ] Health factor calculation

### Integration Tests
- [ ] Oracle integration
- [ ] Multi-asset interactions
- [ ] Liquidation bot behavior

### Invariant Tests
- [ ] totalBorrowed ≤ totalSupplied * maxUtilization
- [ ] Each user's healthFactor > 1 OR liquidatable
- [ ] Sum of deposits = totalAssets (accounting)
- [ ] No negative balances

### Edge Case Tests
- [ ] First deposit (empty pool)
- [ ] Last withdrawal (drain pool)
- [ ] Zero amount operations
- [ ] Max uint256 operations
- [ ] 1 wei operations

---

## References

- [Aave V3 Security](https://github.com/aave/aave-v3-core/tree/master/audits)
- [Compound Security Considerations](https://docs.compound.finance/security/)
- [ERC4626 Security Considerations](https://eips.ethereum.org/EIPS/eip-4626#security-considerations)
- [Morpho Security](https://docs.morpho.org/morpho-blue/security-and-risk-management)
