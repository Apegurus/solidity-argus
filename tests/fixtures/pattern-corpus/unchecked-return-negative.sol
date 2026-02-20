// SPDX-License-Identifier: MIT
// PATTERN: reentrancy (builtin) | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: uses transfer() which auto-reverts on failure
contract CheckedReturn {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function safeWithdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient");
        balances[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }
}
