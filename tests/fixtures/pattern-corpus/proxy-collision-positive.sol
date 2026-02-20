// SPDX-License-Identifier: MIT
// PATTERN: storage-collision | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: custom IMPLEMENTATION_SLOT without ERC1967 standard
contract UnsafeProxy {
    bytes32 private constant IMPLEMENTATION_SLOT = keccak256("custom.impl.slot");
    address public admin;

    constructor(address impl) {
        admin = msg.sender;
        assembly {
            sstore(IMPLEMENTATION_SLOT, impl)
        }
    }

    function upgrade(address newImpl) external {
        require(msg.sender == admin, "Not admin");
        assembly {
            sstore(IMPLEMENTATION_SLOT, newImpl)
        }
    }
}
