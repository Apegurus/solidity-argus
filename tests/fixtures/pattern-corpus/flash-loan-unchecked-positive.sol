// SPDX-License-Identifier: MIT
// PATTERN: unchecked-flash-return | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable: flashLoan invocation without verifying repayment
contract UncheckedFlashBorrower {
    address public lender;

    function executeFlash(uint256 amount) external {
        IFlashLender(lender).flashLoan(address(this), amount, "");
    }

    function onFlashLoan(address, uint256, bytes calldata) external {
        // Does not verify repayment or check return value
    }
}

interface IFlashLender {
    function flashLoan(address borrower, uint256 amount, bytes calldata data) external;
}
