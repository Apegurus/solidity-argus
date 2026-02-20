// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Safe contract with proper gas-conscious patterns
contract GasSafe {
    uint256 public constant MAX_RECIPIENTS = 100;

    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => bool) public isRegistered;
    uint256 public registeredCount;

    // Safe: pull-payment pattern — no loop over dynamic array
    function claimReward() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to claim");
        pendingWithdrawals[msg.sender] = 0;
        payable(msg.sender).transfer(amount);
    }

    // Safe: bounded batch processing with pagination
    function processBatch(uint256 startIndex, uint256 batchSize) external {
        uint256 end = startIndex + batchSize;
        if (end > MAX_RECIPIENTS) {
            end = MAX_RECIPIENTS;
        }
        uint256 totalAmount;
        for (uint256 i = startIndex; i < end; i++) {
            totalAmount += 1 ether;
        }
        pendingWithdrawals[msg.sender] = totalAmount;
    }

    // Safe: mapping-based registration instead of unbounded array growth
    function registerRecipient(address r) external {
        require(!isRegistered[r], "Already registered");
        require(registeredCount < MAX_RECIPIENTS, "Max reached");
        isRegistered[r] = true;
        registeredCount++;
    }

    // Safe: fixed-size iteration, no dynamic length
    function processFixedBatch(address[5] calldata batch) external {
        uint256 totalAmount;
        for (uint256 i = 0; i < 5; i++) {
            totalAmount += 1 ether;
        }
        pendingWithdrawals[batch[0]] = totalAmount;
    }
}
