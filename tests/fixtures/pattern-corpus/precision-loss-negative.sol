// SPDX-License-Identifier: MIT
// PATTERN: lack-of-precision | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: multiplication before division — no precision loss
contract SafeFeeCalculator {
    function calculateFee(uint256 amount, uint256 feeBasisPoints) external pure returns (uint256) {
        // CORRECT: multiply first, then divide
        return amount * feeBasisPoints / 10000;
    }

    function calculateReward(uint256 totalReward, uint256 userShare, uint256 totalShares) external pure returns (uint256) {
        // CORRECT: multiply first, then divide
        return totalReward * userShare / totalShares;
    }
}
