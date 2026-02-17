// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PriceOracle {
    address public token;
    address public pool;
    
    constructor(address _token, address _pool) {
        token = _token;
        pool = _pool;
    }
    
    // VULNERABILITY: Price from single AMM pool — manipulable via flash loan
    function getPrice() external view returns (uint256) {
        // Simulated: read from pool (single source = oracle manipulation risk)
        // In real code: IUniswapV2Pair(pool).getReserves() — single-block manipulable
        return 1000; // simplified placeholder
    }
    
    // VULNERABILITY: Anyone can update the price source
    function setPool(address newPool) external {
        pool = newPool; // Missing: onlyOwner modifier
    }
}
