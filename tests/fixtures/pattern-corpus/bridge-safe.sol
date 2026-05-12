// SPDX-License-Identifier: MIT
// PATTERN: cross-chain-bridge | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: proper cross-chain bridge patterns with validation
contract BridgeSafe {
    address public bridgeAddress;
    address public owner;
    mapping(address => uint256) public balances;
    mapping(bytes32 => bool) public processedNonces;

    constructor(address _bridge) {
        bridgeAddress = _bridge;
        owner = msg.sender;
    }

    // Safe: configurable bridge address (not hardcoded constant)
    function setBridgeAddress(address _newBridge) external {
        require(msg.sender == owner, "Not owner");
        bridgeAddress = _newBridge;
    }

    // Safe: no ecrecover, no cross-chain hashing — standard mapping-based auth
    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }

    // Safe: standard admin function — no bridge message patterns
    function pause() external {
        require(msg.sender == owner, "Not owner");
    }
}
