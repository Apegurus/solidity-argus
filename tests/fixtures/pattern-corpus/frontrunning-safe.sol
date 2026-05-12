// SPDX-License-Identifier: MIT
// PATTERN: front-running patterns | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint expiresAt
    ) external returns (uint[] memory amounts);
}

/// @dev Safe: proper slippage protection and user-specified deadline
contract SafeDEXTrader {
    IUniswapV2Router public router;
    uint256 public constant MAX_SLIPPAGE_BPS = 50;

    function safeSwap(
        address[] calldata path,
        uint amountIn,
        uint expectedOutput,
        uint userDeadline
    ) external {
        uint minOutput = expectedOutput * (10000 - MAX_SLIPPAGE_BPS) / 10000;
        router.swapExactTokensForTokens(amountIn, minOutput, path, msg.sender, userDeadline);
    }
}

/// @dev Safe: uses Chainlink VRF for randomness — no block variable dependency
contract SafeRandomness {
    uint256 public vrfResult;

    function requestRandom() external {
        // Chainlink VRF call — no block variable in hashing
    }

    function fulfillRandomWords(uint256, uint256[] memory randomWords) internal {
        vrfResult = randomWords[0];
    }
}

/// @dev Safe: commit-reveal accepts only bytes32 hash, not raw values
contract SafeCommitReveal {
    mapping(address => bytes32) public commitments;

    function submitCommitment(bytes32 hashedValue) external {
        commitments[msg.sender] = hashedValue;
    }

    function reveal(uint256 value, bytes32 salt) external {
        bytes32 expected = keccak256(abi.encodePacked(value, salt, msg.sender));
        require(commitments[msg.sender] == expected, "Invalid reveal");
        delete commitments[msg.sender];
    }
}
