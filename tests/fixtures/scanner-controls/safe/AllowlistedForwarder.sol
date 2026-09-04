// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract AllowlistedForwarder {
    address private immutable allowedTarget;
    bytes4 private immutable allowedSelector;

    constructor(address allowedTarget_, bytes4 allowedSelector_) {
        allowedTarget = allowedTarget_;
        allowedSelector = allowedSelector_;
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        require(data.length >= 4, "selector missing");
        require(bytes4(data[:4]) == allowedSelector, "selector not allowed");
        (bool success, bytes memory result) = allowedTarget.call(data);
        require(success, "call failed");
        return result;
    }
}
