// SPDX-License-Identifier: MIT
// PATTERN: replay-attack | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: ecrecover without nonce tracking
contract ReplayVulnerable {
    mapping(address => uint256) public balances;

    function claimWithSig(uint256 amount, uint8 v, bytes32 r, bytes32 s) external {
        bytes32 hash = keccak256(abi.encodePacked(msg.sender, amount));
        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "Invalid sig");
        balances[msg.sender] += amount;
    }
}
