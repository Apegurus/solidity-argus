// SPDX-License-Identifier: MIT
// PATTERN: sig-malleability | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: raw ecrecover without s-value canonicalization
contract MalleableSigCheck {
    mapping(bytes32 => bool) public executed;

    function executeWithSig(
        bytes32 dataHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        address signer = ecrecover(dataHash, v, r, s);
        require(signer != address(0), "Bad sig");
        require(!executed[dataHash], "Already done");
        executed[dataHash] = true;
    }
}
