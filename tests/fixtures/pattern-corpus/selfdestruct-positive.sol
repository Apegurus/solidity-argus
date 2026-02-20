// SPDX-License-Identifier: MIT
// PATTERN: selfdestruct | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: contract can be destroyed by owner
contract Destroyable {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function destroy() external {
        require(msg.sender == owner, "Not owner");
        selfdestruct(payable(owner));
    }

    receive() external payable {}
}
