// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPythSafeProbe {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    function getPriceNoOlderThan(bytes32 id, uint256 maxAge) external view returns (Price memory);
}

contract PythSafeNegative {
    uint64 internal constant MAX_CONF_BPS = 50;
    IPythSafeProbe public pyth;
    bytes32 public priceId;

    function readPrice() external view returns (uint256) {
        IPythSafeProbe.Price memory p = pyth.getPriceNoOlderThan(priceId, 60);
        require(p.price > 0, "non-positive price");
        require(p.conf * 10_000 <= uint64(p.price) * MAX_CONF_BPS, "wide confidence");
        return uint256(uint64(p.price));
    }
}
