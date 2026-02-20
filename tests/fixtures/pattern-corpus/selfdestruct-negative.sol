// SPDX-License-Identifier: MIT
// PATTERN: selfdestruct | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: no selfdestruct or suicide, contract persists
contract Persistent {
    address public owner;
    bool public paused;

    constructor() {
        owner = msg.sender;
    }

    function pause() external {
        require(msg.sender == owner, "Not owner");
        paused = true;
    }

    function unpause() external {
        require(msg.sender == owner, "Not owner");
        paused = false;
    }
}
