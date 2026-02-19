// SPDX-License-Identifier: MIT
// PATTERN: storage-collision | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: simple storage contract, no proxy patterns
contract SimpleStorage {
    uint256 private _value;
    address private _owner;

    constructor() {
        _owner = msg.sender;
    }

    function store(uint256 val) external {
        require(msg.sender == _owner, "Not owner");
        _value = val;
    }

    function retrieve() external view returns (uint256) {
        return _value;
    }
}
