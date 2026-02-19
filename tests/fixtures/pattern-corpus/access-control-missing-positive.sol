// SPDX-License-Identifier: MIT
// PATTERN: missing-access-modifier | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: external function modifying critical state without access control
contract UnprotectedTreasury {
    address public admin;
    uint256 public treasuryBalance;

    function setAdmin(address newAdmin) external {
        admin = newAdmin;
    }

    function withdrawAll(address to) public {
        payable(to).transfer(treasuryBalance);
        treasuryBalance = 0;
    }
}
