// SPDX-License-Identifier: MIT
// PATTERN: delegatecall | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: uses regular call, not delegatecall
contract RegularCaller {
    address public target;

    constructor(address _target) {
        target = _target;
    }

    function forward(bytes calldata data) external {
        (bool success, bytes memory result) = target.call(data);
        require(success, string(result));
    }
}
