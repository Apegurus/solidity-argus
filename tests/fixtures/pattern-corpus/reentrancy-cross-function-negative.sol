// SPDX-License-Identifier: MIT
// PATTERN: cross-function-reentrancy | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe: only internal functions contain .call, guarded by reentrancy lock
contract CrossFunctionSafe {
    mapping(address => uint256) public balances;
    bool private _locked;

    modifier nonReentrant() {
        require(!_locked, "Reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount}("");
        require(success, "Failed");
    }

    function withdraw(uint256 amount) private nonReentrant {
        require(balances[msg.sender] >= amount, "Insufficient");
        balances[msg.sender] -= amount;
        _sendEth(msg.sender, amount);
    }
}
