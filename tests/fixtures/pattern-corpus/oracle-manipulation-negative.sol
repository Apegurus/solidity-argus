// SPDX-License-Identifier: MIT
// PATTERN: price-feed-decimals | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: uses internal accounting only
contract InternalAccounting {
    uint256 private _rate;

    constructor(uint256 initialRate) {
        _rate = initialRate;
    }

    function convert(uint256 amount) external view returns (uint256) {
        return amount * _rate / 1e18;
    }

    function setRate(uint256 newRate) external {
        _rate = newRate;
    }
}
