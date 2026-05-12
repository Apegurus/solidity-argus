// SPDX-License-Identifier: MIT
// PATTERN: front-running patterns | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity);
}

/// @dev Vulnerable: multiple front-running / MEV attack vectors
contract VulnerableDEXTrader {
    IUniswapV2Router public router;

    // BUG 1: Zero slippage — sandwich attack vector
    function unsafeSwap(address[] calldata path, uint amountIn) external {
        router.swapExactTokensForTokens(amountIn, 0, path, msg.sender, block.timestamp);
    }

    // BUG 2: block.timestamp as deadline — no actual deadline protection
    function swapWithBadDeadline(address[] calldata path, uint amountIn, uint minOut) external {
        uint deadline = block.timestamp;
        router.swapExactTokensForTokens(amountIn, minOut, path, msg.sender, deadline);
    }
}

/// @dev Vulnerable: predictable randomness from block variables
contract VulnerableRandomness {
    uint256 public lastRandom;

    // BUG 3: block.timestamp as entropy source
    function getRandomNumber() public returns (uint256) {
        uint256 randomSeed = uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender)));
        lastRandom = randomSeed;
        return randomSeed;
    }
}

/// @dev Vulnerable: commit-reveal with raw value instead of hash
contract VulnerableCommitReveal {
    mapping(address => uint256) public commits;

    // BUG 4: Accepts raw uint256 — value visible in calldata, front-runnable
    function commit(uint256 value) external {
        commits[msg.sender] = value;
    }

    function reveal(uint256 value) external {
        require(commits[msg.sender] == value, "Invalid reveal");
        delete commits[msg.sender];
    }
}
