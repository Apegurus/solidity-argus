// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

contract PythUnsafe {
    IPyth private immutable pyth;

    constructor(IPyth pyth_) {
        pyth = pyth_;
    }

    function read(bytes32 priceId) internal view returns (int64) {
        return pyth.getPriceUnsafe(priceId).price;
    }
}
