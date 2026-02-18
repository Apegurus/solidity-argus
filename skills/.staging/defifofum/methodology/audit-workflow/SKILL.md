---
name: audit-workflow
description: Five-phase Solidity audit workflow covering recon, static analysis, manual review, verification, and reporting.
---

<!-- Source: DeFiFoFum/fofum-solidity-skills (MIT) -->

## Audit Methodology

### Phase 1: Reconnaissance (15%)

**Objective:** Understand what you're auditing before looking for bugs.

1. **Scope Definition**
   - [ ] Identify all in-scope contracts
   - [ ] Note external dependencies (OpenZeppelin, etc.)
   - [ ] Identify upgrade patterns (proxy, diamond, etc.)

2. **Architecture Mapping**
   - [ ] Draw contract inheritance graph
   - [ ] Map external calls (who calls who)
   - [ ] Identify entry points (public/external functions)
   - [ ] Note privileged roles (owner, admin, guardian)

3. **Documentation Review**
   - [ ] Read protocol documentation/whitepaper
   - [ ] Understand intended behavior
   - [ ] Note claimed invariants

**Output:** Architecture diagram, entry point list, role map

### Phase 2: Static Analysis (20%)

**Objective:** Catch low-hanging fruit automatically.

1. **Run Slither**
   ```bash
   slither . --print human-summary
   slither . --print contract-summary
   slither .
   ```
   - [ ] Review all HIGH/MEDIUM findings
   - [ ] Triage false positives with evidence
   - [ ] Document true positives

2. **Check Compiler Warnings**
   ```bash
   forge build --force 2>&1 | grep -i warning
   ```

3. **Run Additional Detectors**
   - [ ] `slither-check-erc` for token conformance
   - [ ] `slither-check-upgradeability` for proxies

**Output:** Slither report, triaged findings

### Phase 3: Manual Review (50%)

**Objective:** Find bugs that tools miss.

#### 3.1 Access Control
- [ ] All privileged functions have access control
- [ ] Modifiers are applied consistently
- [ ] No unprotected initializers
- [ ] Role changes require multi-sig or timelock

#### 3.2 Reentrancy
- [ ] State changes before external calls (CEI pattern)
- [ ] ReentrancyGuard on vulnerable functions
- [ ] Read-only reentrancy considered
- [ ] Cross-function reentrancy paths checked

#### 3.3 Input Validation
- [ ] All external inputs validated
- [ ] Array lengths checked
- [ ] Address(0) checks where needed
- [ ] Slippage parameters enforced

#### 3.4 Arithmetic
- [ ] Precision loss in divisions
- [ ] Rounding direction (protocol-favorable)
- [ ] Overflow in Solidity <0.8 or unchecked blocks
- [ ] Casting between types

#### 3.5 Oracle & Price Feeds
- [ ] Stale price checks
- [ ] Freshness thresholds appropriate
- [ ] Flash loan resistance (TWAP vs spot)
- [ ] Fallback oracle behavior

#### 3.6 External Integrations
- [ ] Return values checked
- [ ] Weird token handling (fee-on-transfer, rebasing)
- [ ] Reentrancy from callbacks
- [ ] Protocol assumptions documented

#### 3.7 Economic/Logic
- [ ] Incentive alignment
- [ ] Sandwich/frontrunning vectors
- [ ] Flash loan attack paths
- [ ] Governance manipulation

**See:** `resources/checklist.md` for full 100+ item checklist

### Phase 4: Verification (10%)

**Objective:** Confirm findings with evidence.

1. **Write PoC Tests**
   - Each HIGH/CRITICAL needs a Foundry test
   - Show exact attack path
   - Quantify impact (funds at risk)

2. **Test Edge Cases**
   ```bash
   forge test --match-contract Exploit -vvvv
   ```

3. **Fuzz Critical Functions**
   ```bash
   forge test --match-test testFuzz
   ```

### Phase 5: Reporting (5%)

**Objective:** Communicate findings clearly.

**See:** `resources/report-template.md`

---
