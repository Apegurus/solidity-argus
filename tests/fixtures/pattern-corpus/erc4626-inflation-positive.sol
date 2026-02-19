// SPDX-License-Identifier: MIT
// PATTERN: inflation-attack | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: first depositor inflation attack, convertToShares uses totalSupply directly
contract VulnerableVault {
    uint256 public totalSupply;
    uint256 public totalAssets;
    mapping(address => uint256) public shares;

    function convertToShares(uint256 assets) public view returns (uint256) { return totalSupply == 0 ? assets : assets * totalSupply / totalAssets; }

    function deposit(uint256 assets) external returns (uint256 s) {
        s = convertToShares(assets);
        shares[msg.sender] += s;
        totalSupply += s;
        totalAssets += assets;
    }
}
