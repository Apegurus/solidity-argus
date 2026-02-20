// SPDX-License-Identifier: MIT
// PATTERN: price-feed-decimals | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: priceFeed decimal mismatch risk
contract SpotPriceOracle {
    address public priceFeed;
    uint8 public oracleDecimals;

    constructor(address _priceFeed) {
        priceFeed = _priceFeed;
        oracleDecimals = 8;
    }

    function getSpotPrice(uint256 reserve0, uint256 reserve1) external view returns (uint256) {
        return reserve0 * (10 ** oracleDecimals) / reserve1;
    }
}
