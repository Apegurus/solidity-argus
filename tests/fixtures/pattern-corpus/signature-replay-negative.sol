// SPDX-License-Identifier: MIT
// PATTERN: replay-attack | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: uses mapping-based approval instead of signature recovery
contract MappingAuth {
    mapping(address => bool) public approved;
    address public admin;

    constructor() {
        admin = msg.sender;
    }

    function approve(address user) external {
        require(msg.sender == admin, "Not admin");
        approved[user] = true;
    }

    function doAction() external {
        require(approved[msg.sender], "Not approved");
    }
}
