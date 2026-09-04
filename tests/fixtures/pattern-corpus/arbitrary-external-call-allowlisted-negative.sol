// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ITrustedRouter {
    function swapExactTokens(uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut);
}

contract ArbitraryExternalCallAllowlistedNegative {
    address public immutable trustedRouter;

    constructor(address router) {
        trustedRouter = router;
    }

    function executeTrustedSwap(uint256 amountIn, uint256 minAmountOut) external {
        address router = trustedRouter;
        (bool ok,) = router.call(
            abi.encodeWithSelector(ITrustedRouter.swapExactTokens.selector, amountIn, minAmountOut)
        );
        require(ok, "call failed");
    }
}
