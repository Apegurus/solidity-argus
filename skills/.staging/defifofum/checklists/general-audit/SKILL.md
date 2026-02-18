---
name: general-audit
description: Comprehensive Solidity audit checklist spanning access control, reentrancy, oracles, and integrations.
---

<!-- Source: DeFiFoFum/fofum-solidity-skills (MIT) -->

# Solidity Audit Checklist

## How to Use

- [ ] Check each item during manual review
- Mark as: ✅ Checked/Safe | ⚠️ Finding | ➖ N/A
- Reference SWC IDs for standard vulnerabilities

---

## 1. Access Control (SWC-105, SWC-106)

### Ownership & Roles
- [ ] All privileged functions have access control modifiers
- [ ] Ownership can only be transferred intentionally (2-step preferred)
- [ ] Role changes emit events
- [ ] Critical operations require multi-sig or timelock
- [ ] No unprotected `selfdestruct`

### Initializers
- [ ] `initialize()` can only be called once
- [ ] `initializer` modifier used correctly
- [ ] No uninitialized proxy implementations
- [ ] Constructor vs initializer logic is correct

### Function Visibility
- [ ] Functions default to most restrictive visibility
- [ ] No unintended `public`/`external` functions
- [ ] Internal functions not callable via delegatecall from untrusted contracts

---

## 2. Reentrancy (SWC-107)

### Pattern Detection
- [ ] External calls identified and mapped
- [ ] State changes occur BEFORE external calls (CEI pattern)
- [ ] `ReentrancyGuard` used on state-changing functions with external calls
- [ ] Read-only reentrancy considered (view functions reading stale state)

### Cross-Function Reentrancy
- [ ] Multiple functions sharing state checked
- [ ] Callbacks (ERC777, ERC721 `onReceived`, etc.) don't break invariants
- [ ] Flash loan callbacks don't enable reentrancy

### Cross-Contract Reentrancy
- [ ] External protocol integrations checked for callbacks
- [ ] Composability with other protocols considered

---

## 3. Arithmetic & Precision (SWC-101)

### Overflow/Underflow
- [ ] Solidity >=0.8 or SafeMath used
- [ ] `unchecked` blocks reviewed carefully
- [ ] Casting between types checked (uint256 → uint128, etc.)

### Precision Loss
- [ ] Division before multiplication avoided
- [ ] Rounding direction is protocol-favorable
- [ ] Decimal handling correct (6 vs 18 decimals)
- [ ] Small amounts don't round to zero unexpectedly

### Edge Cases
- [ ] Zero amounts handled correctly
- [ ] Max uint256 values don't cause issues
- [ ] Negative scenarios (if using int types)

---

## 4. Input Validation (SWC-123, SWC-129)

### Parameter Checks
- [ ] All external inputs validated
- [ ] Array lengths checked before use
- [ ] Array lengths match when processing multiple arrays
- [ ] Address(0) checks where appropriate
- [ ] Bounds checking on indices

### Slippage & Deadlines
- [ ] Slippage protection enforced (not just user-settable)
- [ ] Deadline parameters validated and used
- [ ] Price impact limits enforced

---

## 5. External Calls (SWC-104, SWC-113)

### Return Values
- [ ] All return values checked
- [ ] Low-level calls check success boolean
- [ ] ERC20 `transfer`/`transferFrom` return values handled (or SafeERC20 used)

### Call Patterns
- [ ] No unbounded loops with external calls
- [ ] Gas limits on calls considered
- [ ] Fallback behavior on failed calls appropriate

### Delegatecall
- [ ] Delegatecall targets are trusted/immutable
- [ ] Storage layout compatible with delegate targets
- [ ] No user-controlled delegatecall targets

---

## 6. Token Handling

### ERC20 Weirdness
- [ ] Fee-on-transfer tokens: measure balance before/after
- [ ] Rebasing tokens: don't cache balances
- [ ] Missing return values: use SafeERC20
- [ ] Pausable tokens: handle gracefully
- [ ] Blocklist tokens: consider implications
- [ ] Multiple addresses: verify canonical address
- [ ] Approval race condition: use increaseAllowance or set to 0 first

### ERC721/1155
- [ ] `onERC721Received` reentrancy considered
- [ ] Token IDs validated
- [ ] Batch operations gas-bounded

### Native ETH
- [ ] ETH and WETH handled consistently
- [ ] `msg.value` not reused in loops
- [ ] ETH sent to contracts can be received

---

## 7. Oracle & Price Feeds

### Data Freshness
- [ ] Stale price checks implemented
- [ ] Heartbeat/threshold appropriate for use case
- [ ] Fallback oracle behavior defined

### Manipulation Resistance
- [ ] TWAP vs spot price appropriate
- [ ] Flash loan resistance verified
- [ ] Multiple oracle sources considered
- [ ] Sequencer uptime checked (L2s)

### Integration
- [ ] Oracle decimals handled correctly
- [ ] Price ≤ 0 cases handled
- [ ] Round completeness verified (Chainlink)

---

## 8. State & Storage

### State Consistency
- [ ] State updates atomic where needed
- [ ] No partial state on revert
- [ ] Mappings deleted correctly (can't delete mapping)

### Storage Collisions
- [ ] Proxy storage gaps defined
- [ ] No storage slot conflicts in upgrades
- [ ] Struct packing intentional

### Events
- [ ] All state changes emit events
- [ ] Events indexed appropriately
- [ ] No sensitive data in events

---

## 9. Denial of Service (SWC-113, SWC-128)

### Unbounded Operations
- [ ] Loops are bounded
- [ ] Array operations don't exceed block gas limit
- [ ] Push operations have limits

### Griefing
- [ ] Can't force contract into bad state
- [ ] Emergency withdrawal paths exist
- [ ] Time-based locks have reasonable limits

### External Dependencies
- [ ] Protocol continues if oracle fails
- [ ] External contract failures handled gracefully

---

## 10. Frontrunning & MEV (SWC-114)

### Transaction Ordering
- [ ] Commit-reveal for sensitive operations
- [ ] Slippage protection on swaps
- [ ] Deadline parameters enforced

### Sandwich Attacks
- [ ] Large trades protected
- [ ] Price impact limits enforced

### Information Leakage
- [ ] No profitable frontrunning opportunities
- [ ] Auction mechanisms fair

---

## 11. Governance & Timelocks

### Proposals
- [ ] Proposal execution delayed appropriately
- [ ] Quorum requirements sensible
- [ ] Flash loan governance attacks mitigated

### Emergency Functions
- [ ] Emergency pause exists
- [ ] Emergency withdrawal paths exist
- [ ] Guardian powers limited and documented

---

## 12. Upgradeability (SWC-102)

### Proxy Patterns
- [ ] Implementation can't be initialized directly
- [ ] `_disableInitializers()` in constructor
- [ ] Storage gaps for future variables

### Upgrade Safety
- [ ] Upgrade function protected
- [ ] State migration handled
- [ ] Rollback plan exists

---

## 13. Cryptography & Signatures (SWC-117, SWC-121, SWC-122)

### Signature Handling
- [ ] Replay protection (nonces, domain separator)
- [ ] EIP-712 structured data used
- [ ] Signature malleability prevented
- [ ] ecrecover return value checked (not address(0))

### Randomness
- [ ] No on-chain randomness for value-bearing operations
- [ ] VRF or commit-reveal for randomness

---

## 14. Gas & Efficiency

### Gas Limits
- [ ] Loops bounded
- [ ] No gas griefing vectors
- [ ] Estimated gas within block limits

### Optimizations
- [ ] Storage reads minimized (cache in memory)
- [ ] Calldata used where possible
- [ ] Events used instead of storage for historical data

---

## 15. Code Quality

### Documentation
- [ ] NatSpec on public/external functions
- [ ] Complex logic commented
- [ ] Invariants documented

### Testing
- [ ] >80% code coverage
- [ ] Edge cases tested
- [ ] Fuzz testing on critical functions
- [ ] Invariant tests defined

### Best Practices
- [ ] Consistent naming conventions
- [ ] No magic numbers (use constants)
- [ ] Compiler version locked
- [ ] No floating pragma

---

## Quick Reference: SWC IDs

| ID | Name |
|----|------|
| SWC-100 | Function Default Visibility |
| SWC-101 | Integer Overflow/Underflow |
| SWC-102 | Outdated Compiler |
| SWC-103 | Floating Pragma |
| SWC-104 | Unchecked Call Return Value |
| SWC-105 | Unprotected Ether Withdrawal |
| SWC-106 | Unprotected SELFDESTRUCT |
| SWC-107 | Reentrancy |
| SWC-108 | State Variable Default Visibility |
| SWC-110 | Assert Violation |
| SWC-111 | Use of Deprecated Functions |
| SWC-112 | Delegatecall to Untrusted Callee |
| SWC-113 | DoS with Failed Call |
| SWC-114 | Transaction Order Dependence |
| SWC-115 | Authorization through tx.origin |
| SWC-116 | Block Timestamp Dependence |
| SWC-117 | Signature Malleability |
| SWC-118 | Incorrect Constructor Name |
| SWC-119 | Shadowing State Variables |
| SWC-120 | Weak Sources of Randomness |
| SWC-121 | Missing Protection against Signature Replay |
| SWC-122 | Lack of Proper Signature Verification |
| SWC-123 | Requirement Violation |
| SWC-124 | Write to Arbitrary Storage Location |
| SWC-125 | Incorrect Inheritance Order |
| SWC-126 | Insufficient Gas Griefing |
| SWC-127 | Arbitrary Jump with Function Type Variable |
| SWC-128 | DoS With Block Gas Limit |
| SWC-129 | Typographical Error |
| SWC-130 | Right-To-Left-Override control character |
| SWC-131 | Presence of Unused Variables |
| SWC-132 | Unexpected Ether balance |
| SWC-133 | Hash Collisions With Multiple Variable Length Arguments |
| SWC-134 | Message call with hardcoded gas amount |
| SWC-135 | Code With No Effects |
| SWC-136 | Unencrypted Private Data On-Chain |
