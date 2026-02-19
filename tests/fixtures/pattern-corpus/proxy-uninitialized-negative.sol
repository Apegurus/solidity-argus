// SPDX-License-Identifier: MIT
// PATTERN: uninitialized-proxy | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: uses constructor, no proxy initialization pattern
contract DirectToken {
    string public name;
    address public owner;

    constructor(string memory _name) {
        name = _name;
        owner = msg.sender;
    }

    function rename(string memory _name) external {
        require(msg.sender == owner, "Not owner");
        name = _name;
    }
}
