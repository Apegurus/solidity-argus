// SPDX-License-Identifier: MIT
// PATTERN: unprotected-initialize | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: uses setup() instead of initialize(), no proxy pattern
contract DirectSetup {
    address public owner;

    constructor(address _owner) {
        owner = _owner;
    }

    function setup(uint256 param) external {
        require(msg.sender == owner, "Not owner");
        // configuration logic
    }
}
