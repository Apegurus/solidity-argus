---
name: general-audit
description: Comprehensive Solidity audit checklist spanning access control, reentrancy, oracles, and integrations.
category: checklist
---

<!-- Source: DeFiFoFum/fofum-solidity-skills (MIT) -->
<!-- Source: Cyfrin/audit-checklist -->

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

## Additional Checklist IDs (Cyfrin)

- [ ] **[SOL-AM-DOSA-1]** Is the withdrawal pattern followed to prevent denial of service?
- [ ] **[SOL-AM-DOSA-2]** Is there a minimum transaction amount enforced?
- [ ] **[SOL-AM-DOSA-3]** How does the protocol handle tokens with blacklisting functionality?
- [ ] **[SOL-AM-DOSA-4]** Can forcing the protocol to process a queue lead to DOS?
- [ ] **[SOL-AM-DOSA-5]** What happens with low decimal tokens that might cause DOS?
- [ ] **[SOL-AM-DOSA-6]** Does the protocol handle external contract interactions safely?
- [ ] **[SOL-AM-GA-1]** Is there an external function that relies on states that can be changed by others?
- [ ] **[SOL-AM-GA-2]** Can the contract operations be manipulated with precise gas limit specifications?
- [ ] **[SOL-AM-MA-1]** Is block.timestamp used for time-sensitive operations?
- [ ] **[SOL-AM-MA-2]** Is the contract using block properties like timestamp or difficulty for randomness generation?
- [ ] **[SOL-AM-MA-3]** Is contract logic sensitive to transaction ordering?
- [ ] **[SOL-AM-ReentrancyAttack-1]** Is there a view function that can return a stale value during interactions?
- [ ] **[SOL-AM-ReentrancyAttack-2]** Is there any state change after interaction to an external contract?
- [ ] **[SOL-AM-ReplayAttack-1]** Are there protections against replay attacks for failed transactions?
- [ ] **[SOL-AM-ReplayAttack-2]** Is there protection against replaying signatures on different chains?
- [ ] **[SOL-AM-RP-1]** Can the admin of the protocol pull assets from the protocol?
- [ ] **[SOL-AM-SybilAttack-1]** Is there a mechanism depending on the number of users?
- [ ] **[SOL-Basics-AC-1]** Did you clarify all the actors and their allowed interactions in the protocol?
- [ ] **[SOL-Basics-AC-2]** Are there functions lacking proper access controls?
- [ ] **[SOL-Basics-AC-3]** Do certain addresses require whitelisting?
- [ ] **[SOL-Basics-AC-4]** Does the protocol allow transfer of privileges?
- [ ] **[SOL-Basics-AC-5]** What happens during the transfer of privileges?
- [ ] **[SOL-Basics-AC-6]** Does the contract inherit others?
- [ ] **[SOL-Basics-AC-7]** Does the contract use `tx.origin` in validation?
- [ ] **[SOL-Basics-AL-1]** What happens on the first and the last cycle of the iteration?
- [ ] **[SOL-Basics-AL-4]** How does the protocol remove an item from an array?
- [ ] **[SOL-Basics-AL-5]** Does any function get an index of an array as an argument?
- [ ] **[SOL-Basics-AL-6]** Is the summing of variables done accurately compared to separate calculations?
- [ ] **[SOL-Basics-AL-7]** Is it fine to have duplicate items in the array?
- [ ] **[SOL-Basics-AL-8]** Is there any issue with the first and the last iteration?
- [ ] **[SOL-Basics-AL-9]** Is there possibility of iteration of a huge array?
- [ ] **[SOL-Basics-AL-10]** Is there a potential for a Denial-of-Service (DoS) attack in the loop?
- [ ] **[SOL-Basics-AL-11]** Is `msg.value` used within a loop?
- [ ] **[SOL-Basics-AL-12]** Is there a loop to handle batch fund transfer?
- [ ] **[SOL-Basics-AL-13]** Is there a break or continue inside a loop?
- [ ] **[SOL-Basics-Event-1]** Does the protocol emit events on important state changes?
- [ ] **[SOL-Basics-Function-1]** Are the inputs validated?
- [ ] **[SOL-Basics-Function-2]** Are the outputs validated?
- [ ] **[SOL-Basics-Function-3]** Can the function be front-run?
- [ ] **[SOL-Basics-Function-4]** Are the code comments coherent with the implementation?
- [ ] **[SOL-Basics-Function-5]** Can edge case inputs (0, max) result in unexpected behavior?
- [ ] **[SOL-Basics-Function-6]** Does the function allow arbitrary user input?
- [ ] **[SOL-Basics-Function-7]** Should it be `external`/`public`?
- [ ] **[SOL-Basics-Function-8]** Does this function need to be called by only EOA or only contracts?
- [ ] **[SOL-Basics-Function-9]** Does this function need to be restricted for specific callers?
- [ ] **[SOL-Basics-Inheritance-1]** Is it necessary to limit visibility of parent contract's public functions?
- [ ] **[SOL-Basics-Inheritance-2]** Were all necessary functions implemented to fulfill inheritance purpose?
- [ ] **[SOL-Basics-Inheritance-3]** Has the contract implemented an interface?
- [ ] **[SOL-Basics-Inheritance-4]** Does the inheritance order matter?
- [ ] **[SOL-Basics-Initialization-1]** Are important state variables initialized properly?
- [ ] **[SOL-Basics-Initialization-2]** Has the contract inherited OpenZeppelin's Initializable?
- [ ] **[SOL-Basics-Initialization-3]** Does the contract have a separate initializer function other than a constructor?
- [ ] **[SOL-Basics-Map-1]** Is there need to delete the existing item from a map?
- [ ] **[SOL-Basics-Math-1]** Is the mathematical calculation accurate?
- [ ] **[SOL-Basics-Math-2]** Is there any loss of precision in time calculations?
- [ ] **[SOL-Basics-Math-3]** Are you aware that expressions like `1 day` are cast to `uint24`, potentially causing overflows?
- [ ] **[SOL-Basics-Math-4]** Is there any case where dividing is done before multiplication?
- [ ] **[SOL-Basics-Math-5]** Does the rounding direction matter?
- [ ] **[SOL-Basics-Math-6]** Is there a possibility of division by zero?
- [ ] **[SOL-Basics-Math-7]** Even in versions like `>0.8.0`, have you ensured variables won't underflow or overflow leading to reverts?
- [ ] **[SOL-Basics-Math-8]** Are you aware that assigning a negative value to an unsigned integer causes a revert?
- [ ] **[SOL-Basics-Math-9]** Have you properly reviewed all usages of `unchecked{}`?
- [ ] **[SOL-Basics-Math-10]** In comparisons using < or >, should you instead be using ≤ or ≥?
- [ ] **[SOL-Basics-Math-11]** Have you taken into consideration mathematical operations in inline assembly?
- [ ] **[SOL-Basics-Math-12]** What happens for the minimum/maximum values included in the calculation?
- [ ] **[SOL-Basics-Payment-1]** Is it possible for the receiver to revert?
- [ ] **[SOL-Basics-Payment-2]** Does the function gets the payment amount as a parameter?
- [ ] **[SOL-Basics-Payment-3]** Are there vulnerabilities related to force-feeding?
- [ ] **[SOL-Basics-Payment-4]** What is the minimum deposit/withdrawal amount?
- [ ] **[SOL-Basics-Payment-5]** How is the withdrawal handled?
- [ ] **[SOL-Basics-Payment-7]** Is it possible for native ETH to be locked in the contract?
- [ ] **[SOL-Basics-Type-1]** Is there a forced type casting?
- [ ] **[SOL-Basics-Type-2]** Does the protocol use time units like `days`?
- [ ] **[SOL-CR-1]** What happens to the user accounting in special conditions?
- [ ] **[SOL-CR-2]** Is there a pause mechanism?
- [ ] **[SOL-CR-3]** Is there a functionality for the admin to withdraw from the protocol?
- [ ] **[SOL-CR-4]** Can the admin change critical protocol property immediately?
- [ ] **[SOL-CR-5]** Is there any admin setter function missing events?
- [ ] **[SOL-CR-6]** How is the ownership/privilege transferred??
- [ ] **[SOL-CR-7]** Is there a proper validation in privileged setter functions?
- [ ] **[SOL-EC-1]** What are the implications if the call reenters a different function?
- [ ] **[SOL-EC-2]** Is there a multi-call?
- [ ] **[SOL-EC-3]** What are the risks associated with using delegatecall in smart contracts?
- [ ] **[SOL-EC-4]** Is the external contract call necessary?
- [ ] **[SOL-EC-5]** Has the called address been whitelisted?
- [ ] **[SOL-EC-6]** Is there suspicion when a fixed gas amount is specified?
- [ ] **[SOL-EC-8]** Is the contract passing large data to an unknown address?
- [ ] **[SOL-EC-10]** Are there any delegate calls to non-library contracts?
- [ ] **[SOL-EC-11]** Is there a strict policy against delegate calls to untrusted contracts?
- [ ] **[SOL-EC-12]** Is the address's existence verified?
- [ ] **[SOL-EC-13]** Is the check-effect-interaction pattern being utilized?
- [ ] **[SOL-EC-14]** How is the msg.sender handled?
- [ ] **[SOL-LL-1]** Is there validation on the size of the input data?
- [ ] **[SOL-LL-2]** What happens if there is no matching function signature?
- [ ] **[SOL-LL-3]** Is it checked if the target address of a call has the code?
- [ ] **[SOL-LL-4]** Is there a check on the return data size when calling precompiled code?
- [ ] **[SOL-LL-5]** Is there a non-zero check for the denominator?
- [ ] **[SOL-Signature-1]** Are signatures guarded against replay attacks?
- [ ] **[SOL-Signature-2]** Are signatures protected against malleability issues?
- [ ] **[SOL-Signature-3]** Does the returned public key from the signature verification match the expected public key?
- [ ] **[SOL-Signature-4]** Is the signature originating from the appropriate entity?
- [ ] **[SOL-Signature-5]** If the signature has a deadline, is it still valid?
