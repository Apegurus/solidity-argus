// SPDX-License-Identifier: MIT
// PATTERN: donation-attacks | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

/// @dev Safe vault: virtual offset protection, internal accounting, no direct transfers
contract SafeDonationVault {
    address public immutable asset;
    uint256 private _supply;
    uint256 private _assets;
    mapping(address => uint256) public balances;

    uint256 private constant VIRTUAL_OFFSET = 1e3;
    uint256 private constant MIN_DEPOSIT = 1e6;

    constructor(address _asset) {
        asset = _asset;
    }

    /// @dev Uses internal accounting, not balanceOf
    function internalTotalAssets() public view returns (uint256) {
        return _assets + VIRTUAL_OFFSET;
    }

    function internalTotalSupply() public view returns (uint256) {
        return _supply + VIRTUAL_OFFSET;
    }

    /// @dev SAFE: virtual offset in share calculation, minimum deposit enforced
    function deposit(uint256 amt, address receiver) external returns (uint256) {
        require(amt >= MIN_DEPOSIT, "Below minimum deposit");

        // Virtual offset ensures no inflation — supply and assets never zero
        uint256 minted = amt * internalTotalSupply() / internalTotalAssets();
        require(minted > 0, "Zero shares");

        balances[receiver] += minted;
        _supply += minted;
        _assets += amt;
        IERC20(asset).transferFrom(msg.sender, address(this), amt);
        return minted;
    }

    /// @dev SAFE: uses transferFrom (pulls from sender), not transfer to self
    function withdraw(uint256 sharesToBurn, address receiver) external returns (uint256) {
        uint256 redeemed = sharesToBurn * internalTotalAssets() / internalTotalSupply();
        balances[msg.sender] -= sharesToBurn;
        _supply -= sharesToBurn;
        _assets -= redeemed;
        IERC20(asset).transferFrom(address(this), receiver, redeemed);
        return redeemed;
    }
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
