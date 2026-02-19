// SPDX-License-Identifier: MIT
// PATTERN: stale-price-check | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

interface AggregatorV3Interface {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @dev Vulnerable: uses latestRoundData without checking updatedAt
contract StaleOracle {
    AggregatorV3Interface public feed;

    constructor(address _feed) {
        feed = AggregatorV3Interface(_feed);
    }

    function getPrice() external view returns (int256) {
        (, int256 price,,,) = feed.latestRoundData();
        return price;
    }
}
