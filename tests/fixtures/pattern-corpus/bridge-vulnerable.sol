// SPDX-License-Identifier: MIT
// PATTERN: cross-chain-bridge | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: cross-chain bridge patterns without proper validation
contract BridgeVulnerable {
    address constant BRIDGE_RELAY = 0x1234567890AbcdEF1234567890aBcdef12345678;
    mapping(address => uint256) public balances;
    mapping(bytes32 => bool) public processedMessages;

    // Vuln 1: missing-chain-id-validation
    // Hash does not include block.chainid — replayable across chains
    function verifyMessage(address sender, uint256 amount, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 hash = keccak256(abi.encodePacked(sender, amount));
        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "Invalid signature");
        balances[sender] += amount;
    }

    // Vuln 2: replay-across-chains
    // ecrecover without chainId in the signed data
    function claimCrossChain(uint256 amount, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 hash = keccak256(abi.encodePacked(msg.sender, amount, nonce));
        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "Bad sig");
        balances[msg.sender] += amount;
    }

    // Vuln 3: unverified-bridge-message
    // No verification of msg.sender being the bridge
    function onMessageReceived(uint256 srcChainId, bytes calldata payload) external {
        (address recipient, uint256 amount) = abi.decode(payload, (address, uint256));
        balances[recipient] += amount;
    }

    // Vuln 4: hardcoded-bridge-address
    // Already declared at top: address constant BRIDGE_RELAY
    function sendViaBridge(uint256 amount) external {
        // Uses hardcoded BRIDGE_RELAY
        balances[msg.sender] -= amount;
    }
}
