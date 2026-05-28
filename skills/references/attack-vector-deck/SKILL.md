---
name: attack-vector-deck
description: Compact catalogue of concrete Solidity vulnerability vectors with detection cues and false-positive guards.
category: reference
source_url: https://github.com/Apegurus/solidity-argus
source_license: MIT
imported_at: "2026-05-18T00:00:00Z"
---

# Attack-Vector Deck

Use this as a review catalogue, not as an automatic finding source. A vector becomes a finding only after proving reachability, missing guard or broken accounting, and impact in the reviewed code.

## Vectors

**1. Unprotected Privileged State Change**
- **D:** External/public function mutates admin-controlled state without a role, owner, governance, or contract-only guard.
- **FP:** The function is reachable only during construction/initialization or guarded by an equivalent custom authorization check.

**2. Initializer or Upgrade Authority Takeover**
- **D:** Proxy implementation, initializer, upgrade function, or ownership transfer can be called by an unintended account or more than once.
- **FP:** Initializer is disabled on the implementation and proxy initialization is atomic with deployment.

**3. Share or Reward Accumulator Drift**
- **D:** Deposits, withdrawals, reward-rate changes, or supply changes occur without settling global/user accumulators first.
- **FP:** Every state-changing path checkpoints both global and user state before mutating rates, balances, or supply.

**4. Decimal or Scale Mismatch**
- **D:** Assets, oracle prices, shares, or rewards with different decimals are multiplied/divided without explicit normalization.
- **FP:** Code normalizes all operands to a documented common scale before arithmetic.

**5. Rounding Direction Value Leak**
- **D:** Mint/redeem/borrow/liquidate paths round in the user's favor across repeatable operations.
- **FP:** Rounding direction is explicit, bounded, and unfavorable to the caller where value can be extracted.

**6. Callback or Reentrancy State Desynchronization**
- **D:** External calls, token hooks, receiver callbacks, or low-level calls occur before all dependent state is finalized.
- **FP:** Reentrancy guard plus checks-effects-interactions cover every callable path sharing the same state.

**7. Oracle or Spot Price Manipulation**
- **D:** Critical mint/borrow/liquidation/swap logic uses spot AMM reserves or a manipulable single-source price.
- **FP:** Price source is TWAP/medianized/bounded and stale/manipulated values are rejected.

**8. Fee-On-Transfer or Rebasing Token Desync**
- **D:** Protocol credits requested transfer amounts instead of observed balance deltas for arbitrary ERC20s.
- **FP:** Accounting uses pre/post balance deltas or the token set is strictly allowlisted to standard behavior.

**9. Cross-Chain Message Spoofing or Replay**
- **D:** Receiver accepts messages without validating endpoint, chain/domain, registered peer, nonce, or replay status.
- **FP:** Endpoint, origin, chain/domain, and replay protection are all enforced before effects.

**10. Queue or Async Flow Parameter Divergence**
- **D:** Request parameters are stored, transformed, or fulfilled later with mutable global parameters that can drift unfairly.
- **FP:** The request snapshots all price/rate/limit parameters needed for fair fulfillment.

**11. Periphery Encoder or Adapter Semantic Mismatch**
- **D:** Helper, router, adapter, or library changes calldata/order/units/trust assumptions relative to the core contract.
- **FP:** Adapter invariants are documented and tested against the core contract's expected semantics.

**12. Invariant Broken by Donation or Direct Transfer**
- **D:** Accounting assumes token balance equals internal tracked balance, but anyone can transfer assets directly.
- **FP:** Conversions use internal accounting or explicitly handle unsolicited balance changes.
