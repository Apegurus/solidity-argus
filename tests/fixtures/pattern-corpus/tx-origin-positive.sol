// SPDX-License-Identifier: MIT
// PATTERN: tx-origin-auth | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: tx.origin for authorization, phishing attack vector
contract TxOriginAuth {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function withdraw() external {
        require(tx.origin == owner, "Not owner");
        payable(msg.sender).transfer(address(this).balance);
    }

    receive() external payable {}
}
