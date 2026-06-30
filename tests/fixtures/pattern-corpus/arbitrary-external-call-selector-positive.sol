// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract ArbitraryExternalCallSelectorPositive {
    function execute(address target, bytes4 selector, uint256 amount) external {
        (bool ok,) = target.call(abi.encodeWithSelector(selector, msg.sender, amount));
        require(ok, "call failed");
    }
}
