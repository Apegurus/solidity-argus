// SPDX-License-Identifier: MIT
// PATTERN: delegatecall | EXPECTED: NEGATIVE (keyword only in comments)
pragma solidity ^0.8.0;

/// @dev This contract does NOT use .delegatecall() in code.
/// The word delegatecall appears only in comments and strings.
contract SafeForwarder {
    address public target;

    constructor(address _target) {
        target = _target;
    }

    /* Multi-line comment mentioning .delegatecall( for docs */
    function forward(bytes calldata data) external {
        // Using regular call, not delegatecall
        string memory note = "delegatecall is not used here";
        (bool success, bytes memory result) = target.call(data);
        require(success, string(result));
    }
}
