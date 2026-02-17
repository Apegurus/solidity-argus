// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract VulnerableVault {
    mapping(address => uint256) public balances;
    address public owner;
    
    constructor() {
        owner = msg.sender;
    }
    
    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }
    
    // VULNERABILITY: Missing access control — anyone can call withdraw for any user
    // VULNERABILITY: Reentrancy — state update AFTER external call
    function withdraw(address payable to, uint256 amount) external {
        require(balances[to] >= amount, "Insufficient balance");
        (bool success, ) = to.call{value: amount}("");  // external call BEFORE state update
        require(success, "Transfer failed");
        balances[to] -= amount;  // state update AFTER — reentrancy!
    }
    
    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }
}
