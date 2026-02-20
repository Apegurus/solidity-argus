// SPDX-License-Identifier: MIT
// PATTERN: stale-price-check | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: uses hardcoded price, no oracle dependency
contract FixedPriceProvider {
    uint256 public constant FIXED_RATE = 1e18;

    function convert(uint256 amount) external pure returns (uint256) {
        return amount * FIXED_RATE / 1e18;
    }
}
