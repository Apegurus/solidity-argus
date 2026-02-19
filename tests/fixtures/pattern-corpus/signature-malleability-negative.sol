// SPDX-License-Identifier: MIT
// PATTERN: sig-malleability | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: uses ECDSA library with canonical s enforcement
library ECDSA {
    function recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        // OpenZeppelin ECDSA.recover enforces s <= secp256k1n/2
        return address(0); // placeholder
    }
}

contract SafeSigCheck {
    using ECDSA for bytes32;
    mapping(bytes32 => bool) public executed;

    function executeWithSig(bytes32 dataHash, bytes memory sig) external {
        address signer = dataHash.recover(sig);
        require(signer != address(0), "Bad sig");
        require(!executed[dataHash], "Already done");
        executed[dataHash] = true;
    }
}
