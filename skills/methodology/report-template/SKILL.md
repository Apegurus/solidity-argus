---
name: report-template
description: Reusable smart contract audit report structure with severity IDs, finding sections, and appendices.
---
<!-- Source: DeFiFoFum/fofum-solidity-skills (MIT) -->

# Audit Report Template

## Header

```markdown
# Security Audit Report

**Protocol:** [Protocol Name]
**Version:** [Commit Hash / Version]
**Auditor:** [Your Name / Firm]
**Date:** [YYYY-MM-DD]
**Review Period:** [Start Date] - [End Date]

## Scope

| Contract | SLOC | Purpose |
|----------|------|---------|
| Vault.sol | 245 | Main vault logic |
| Oracle.sol | 89 | Price feed wrapper |

**Out of Scope:**
- Test files
- Deployment scripts
- External dependencies (OpenZeppelin)
```

---

## Executive Summary

```markdown
## Executive Summary

[Protocol Name] is a [brief description]. This audit reviewed [X] contracts
totaling [Y] lines of code.

### Findings Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 5 |
| Informational | 4 |

### Key Observations

- [Positive observation about code quality]
- [Main concern or risk area]
- [Recommendation summary]
```

---

## Finding Format

```markdown
## [H-01] Title Describing the Vulnerability

### Severity
**High**

### Location
`src/Vault.sol:142-156`

### Description
[Clear explanation of the vulnerability, what's wrong, and why it matters]

The `withdraw()` function sends ETH to the user before updating their balance,
creating a reentrancy vulnerability:

```solidity
function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount, "Insufficient");
    
    (bool success,) = msg.sender.call{value: amount}("");  // External call
    require(success, "Transfer failed");
    
    balances[msg.sender] -= amount;  // State update AFTER call
}
```

### Impact
An attacker can drain all ETH from the contract by recursively calling
`withdraw()` before the balance is updated.

**Funds at Risk:** All ETH in contract (~$X at time of audit)

### Proof of Concept

```solidity
contract Attacker {
    Vault vault;
    
    function attack() external payable {
        vault.deposit{value: 1 ether}();
        vault.withdraw(1 ether);
    }
    
    receive() external payable {
        if (address(vault).balance >= 1 ether) {
            vault.withdraw(1 ether);
        }
    }
}
```

### Recommendation

Apply the Checks-Effects-Interactions (CEI) pattern:

```solidity
function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount, "Insufficient");
    
    balances[msg.sender] -= amount;  // State update BEFORE call
    
    (bool success,) = msg.sender.call{value: amount}("");
    require(success, "Transfer failed");
}
```

Alternatively, use OpenZeppelin's `ReentrancyGuard`.

### Developer Response
[Leave space for protocol team to respond]
```

---

## Finding ID Convention

- `[C-XX]` - Critical
- `[H-XX]` - High  
- `[M-XX]` - Medium
- `[L-XX]` - Low
- `[I-XX]` - Informational
- `[G-XX]` - Gas Optimization

---

## Appendix Sections

```markdown
## Appendix A: Methodology

This audit followed a structured approach:
1. **Reconnaissance:** Architecture mapping, entry point identification
2. **Static Analysis:** Slither, compiler warnings
3. **Manual Review:** Line-by-line review against checklist
4. **Testing:** Foundry tests for findings

## Appendix B: Tools Used

- Slither v0.10.0
- Foundry (forge 0.2.0)
- VS Code with Solidity extensions

## Appendix C: Scope Verification

All in-scope contracts were reviewed. The following were explicitly excluded:
- [List excluded items]

## Appendix D: Disclaimer

This audit does not guarantee the absence of vulnerabilities. Smart contract
security is a continuous process, and we recommend ongoing security practices
including bug bounties, monitoring, and incident response planning.
```

---

## Quick Checklist for Report Quality

- [ ] All findings have clear titles
- [ ] Severity is justified
- [ ] Location includes file:line
- [ ] Description is understandable by non-experts
- [ ] Impact quantifies risk where possible
- [ ] PoC is provided for High/Critical
- [ ] Recommendation is actionable
- [ ] Executive summary is concise
- [ ] Scope is clearly defined
