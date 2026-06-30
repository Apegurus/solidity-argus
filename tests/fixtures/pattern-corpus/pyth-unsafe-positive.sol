// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPythUnsafeProbe {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory);
}

contract PythUnsafePositive {
    IPythUnsafeProbe public pyth;
    bytes32 public priceId;

    function readPrice() external view returns (uint256) {
        IPythUnsafeProbe.Price memory p = pyth.getPriceUnsafe(priceId);
        return uint256(uint64(p.price));
    }
}
