// SPDX-License-Identifier: MIT
// PATTERN: unprotected-initialize | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: initialize function without initializer modifier
contract UnprotectedProxy {
    address public owner;
    bool public initialized;

    function initialize(address _owner) external {
        require(!initialized, "Already init");
        owner = _owner;
        initialized = true;
    }

    function doAction() external {
        require(msg.sender == owner, "Not owner");
    }
}
