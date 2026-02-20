// SPDX-License-Identifier: MIT
// PATTERN: tx-origin-auth | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: uses msg.sender for authorization
contract MsgSenderAuth {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function withdraw() external {
        require(msg.sender == owner, "Not owner");
        payable(msg.sender).transfer(address(this).balance);
    }

    receive() external payable {}
}
