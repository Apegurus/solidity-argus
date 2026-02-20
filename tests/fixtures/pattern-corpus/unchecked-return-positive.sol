// SPDX-License-Identifier: MIT
// PATTERN: reentrancy (builtin) | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: low-level .call{value:} without checking return value
contract UncheckedReturn {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function unsafeWithdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient");
        balances[msg.sender] -= amount;
        // BUG: return value not checked
        msg.sender.call{value: amount}("");
    }
}
