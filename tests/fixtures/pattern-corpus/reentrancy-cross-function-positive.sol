// SPDX-License-Identifier: MIT
// PATTERN: cross-function-reentrancy | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: external function with .call — cross-function reentrancy risk
contract CrossFunctionVulnerable {
    mapping(address => uint256) public balances;
    uint256 public totalDeposits;

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient");
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Failed");
        balances[msg.sender] -= amount;
        totalDeposits -= amount;
    }

    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }
}
