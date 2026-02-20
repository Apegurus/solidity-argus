// SPDX-License-Identifier: MIT
// PATTERN: missing-access-modifier | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: only internal/private functions, no external/public
contract InternalOnlyLogic {
    uint256 private _value;
    address private _owner;

    constructor() {
        _owner = msg.sender;
    }

    function _updateValue(uint256 newValue) internal {
        _value = newValue;
    }

    function _getValue() internal view returns (uint256) {
        return _value;
    }

    function _checkOwner() private view {
        require(msg.sender == _owner, "Not owner");
    }
}
