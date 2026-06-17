// SPDX-License-Identifier: MIT
// PATTERN: lack-of-precision | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: division before multiplication causes precision loss
contract PrecisionLoss {
    function calculateFee(uint256 amount, uint256 daysEarly) external pure returns (uint256) {
        // BUG: division before multiplication — truncates precision
        uint256 dailyRate = amount / 365;
        uint256 fee = dailyRate * daysEarly;
        return fee;
    }

    function distribute(uint256 reward, uint256 totalShares, uint256 userBalance) external pure returns (uint256) {
        // BUG: reward / totalShares truncates to 0 when reward < totalShares
        return reward / totalShares * userBalance;
    }
}
