// SPDX-License-Identifier: MIT
// PATTERN: uninitialized-proxy | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Detectable: uses initializer modifier pattern
contract UpgradeableToken {
    string public name;
    address public owner;
    bool private _initialized;

    modifier initializer() {
        require(!_initialized, "Already initialized");
        _initialized = true;
        _;
    }

    function init(string memory _name, address _owner) external initializer {
        name = _name;
        owner = _owner;
    }
}
