// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract GovernanceToken {
    address public admin;
    mapping(address => bool) public governors;
    mapping(uint256 => uint256) public votes;
    
    constructor() {
        admin = msg.sender;
        governors[msg.sender] = true;
    }
    
    function addGovernor(address account) external {
        require(msg.sender == admin, "Not admin");
        governors[account] = true; // VULNERABILITY: No timelock — instant governance change
    }
    
    // VULNERABILITY: Admin can be changed immediately without delay
    function changeAdmin(address newAdmin) external {
        require(msg.sender == admin, "Not admin");
        admin = newAdmin; // No timelock, no 2-step ownership transfer
    }
    
    function vote(uint256 proposalId) external {
        require(governors[msg.sender], "Not a governor");
        votes[proposalId]++;
    }
}
