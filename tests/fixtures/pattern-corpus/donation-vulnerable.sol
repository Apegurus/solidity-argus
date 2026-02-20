// SPDX-License-Identifier: MIT
// PATTERN: donation-attacks | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable vault: first depositor inflation, direct token donation, empty pool exploit
contract VulnerableDonationVault {
    address public immutable asset;
    uint256 private _totalShares;
    mapping(address => uint256) public balances;

    constructor(address _asset) {
        asset = _asset;
    }

    function totalSupply() public view returns (uint256) {
        return _totalShares;
    }

    function totalAssets() public view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    /// @dev VULNERABLE: empty pool exploit + first depositor inflation
    function deposit(uint256 assets, address receiver) external returns (uint256) {
        uint256 shares;

        // Pattern: totalSupply() == 0 — empty pool with no minimum deposit
        if (totalSupply() == 0) {
            // Pattern: shares = assets — direct 1:1 mapping, no virtual offset
            shares = assets;
        } else {
            shares = assets * totalSupply() / totalAssets();
        }

        balances[receiver] += shares;
        _totalShares += shares;
        IERC20(asset).transferFrom(msg.sender, address(this), assets);
        return shares;
    }

    /// @dev VULNERABLE: direct token transfer to vault bypasses accounting
    function sweepDust(address token, uint256 amount) external {
        IERC20(token).transfer(address(this), amount);
    }

    /// @dev VULNERABLE: safeTransfer variant of direct donation
    function compoundYield(uint256 earned) external {
        IERC20(asset).safeTransfer(address(this), earned);
    }

    function withdraw(uint256 shares, address receiver) external returns (uint256) {
        uint256 assets = shares * totalAssets() / totalSupply();
        balances[msg.sender] -= shares;
        _totalShares -= shares;
        IERC20(asset).transfer(receiver, assets);
        return assets;
    }
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function safeTransfer(address to, uint256 amount) external;
}
