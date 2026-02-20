// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Vulnerable contract demonstrating gas-related DoS vectors
contract GasVulnerable {
    address[] public recipients;
    mapping(address => uint256) public balances;
    uint256[] public rewards;

    // unbounded-loop: iterates over dynamic array length
    function distributeRewards() external {
        for (uint256 i = 0; i < recipients.length; i++) {
            payable(recipients[i]).transfer(1 ether);
        }
    }

    // storage-write-in-loop: state variable assignment inside loop
    function updateAllBalances(uint256 amount) external {
        for (uint256 i = 0; i < recipients.length; i++) {
            balances[recipients[i]] = amount;
        }
    }

    // external-call-in-loop: .call{value} inside a for-loop
    function sendEtherToAll() external {
        for (uint256 i = 0; i < recipients.length; i++) {
            (bool success, ) = recipients[i].call{value: 1 ether}("");
            require(success, "Transfer failed");
        }
    }

    // unchecked-array-growth: push without length bound
    function addRecipient(address r) external {
        recipients.push(r);
    }

    // Also vulnerable: while loop with .length
    function processWhileLoop() external {
        uint256 i = 0;
        while (i < rewards.length) {
            balances[recipients[i]] = rewards[i];
            i++;
        }
    }
}
