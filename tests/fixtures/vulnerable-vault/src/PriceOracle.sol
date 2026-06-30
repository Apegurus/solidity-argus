// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PriceOracle {
    address public token;
    address public pool;
    
    constructor(address _token, address _pool) {
        token = _token;
        pool = _pool;
    }
    
    // VULNERABILITY: Price from a single AMM pool's spot reserves — manipulable via flash loan (no TWAP)
    function getPrice() external view returns (uint256) {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pool).getReserves();
        require(r0 > 0, "no liquidity");
        return (uint256(r1) * 1e18) / uint256(r0);
    }
    
    // VULNERABILITY: Anyone can update the price source
    function setPool(address newPool) external {
        pool = newPool; // Missing: onlyOwner modifier
    }
}

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}
