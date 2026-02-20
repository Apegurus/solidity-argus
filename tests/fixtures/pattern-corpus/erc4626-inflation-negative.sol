// SPDX-License-Identifier: MIT
// PATTERN: inflation-attack | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: uses virtual offset protection, no direct totalSupply in share calc
contract ProtectedVault {
    uint256 private _supply;
    uint256 private _assets;
    mapping(address => uint256) public shares;

    uint256 private constant OFFSET = 1e3;

    function _computeShares(uint256 amt) internal view returns (uint256) {
        uint256 supply = _supply + OFFSET;
        uint256 assets = _assets + OFFSET;
        return amt * supply / assets;
    }

    function mint(uint256 amt) external returns (uint256 s) {
        s = _computeShares(amt);
        shares[msg.sender] += s;
        _supply += s;
        _assets += amt;
    }
}
