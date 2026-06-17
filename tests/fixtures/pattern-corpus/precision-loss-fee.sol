// SPDX-License-Identifier: MIT
// PATTERN: lack-of-precision | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Another precision loss scenario: fee calculation with division before multiplication
contract FeeCalculator {
    function calculateFee(uint256 amount, uint256 feeBasisPoints) external pure returns (uint256) {
        // BUG: division before multiplication in fee calculation
        return amount / 10000 * feeBasisPoints;
    }

    function calculateReward(uint256 totalReward, uint256 userShare, uint256 totalShares) external pure returns (uint256) {
        // BUG: division truncates before multiplication
        return totalReward / totalShares * userShare;
    }
}
