// SPDX-License-Identifier: MIT
// PATTERN: delegatecall | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: delegatecall to user-controlled address
contract DelegatecallProxy {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function forward(address target, bytes calldata data) external {
        (bool success, ) = target.delegatecall(data);
        require(success, "Delegatecall failed");
    }
}
