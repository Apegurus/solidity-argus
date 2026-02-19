// SPDX-License-Identifier: MIT
// PATTERN: unchecked-flash-return | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: standard lending without flash mechanics
contract SimpleLender {
    mapping(address => uint256) public deposits;

    function deposit() external payable {
        deposits[msg.sender] += msg.value;
    }

    function borrow(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "Insufficient collateral");
        payable(msg.sender).transfer(amount);
    }
}
