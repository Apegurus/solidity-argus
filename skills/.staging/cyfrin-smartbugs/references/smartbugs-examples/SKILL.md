---
name: smartbugs-examples
description: SmartBugs curated dataset — 143 annotated vulnerable Solidity contracts organized by DASP vulnerability category
---

<!-- Source: smartbugs/smartbugs-curated (Apache-2.0) -->
<!-- Auto-generated from https://github.com/smartbugs/smartbugs-curated -->
<!-- Total contracts: 143 -->
<!-- Categories: 10 -->

# SmartBugs Curated Dataset — Vulnerable Contract Examples

The [SmartBugs curated dataset](https://github.com/smartbugs/smartbugs-curated) is a collection of **143 annotated vulnerable Solidity contracts**, organized by the [DASP taxonomy](https://dasp.co/) of smart contract vulnerabilities.

Each contract includes line-level annotations identifying the exact location of vulnerabilities, making this dataset invaluable for:
- Testing static analysis tools
- Learning vulnerability patterns
- Building detection heuristics

> **Note:** Contracts are referenced via GitHub URLs — source files are NOT copied into this plugin.

## Dataset Overview

| DASP Category | Contracts |
|---------------|-----------|
| Access Control (DASP #2) | 18 |
| Arithmetic / Integer Overflow (DASP #3) | 15 |
| Bad Randomness (DASP #6) | 8 |
| Denial of Service (DASP #5) | 6 |
| Front Running (DASP #7) | 4 |
| Other / Uncategorized (DASP #10) | 3 |
| Reentrancy (DASP #1) | 31 |
| Short Addresses (DASP #9) | 1 |
| Time Manipulation (DASP #8) | 5 |
| Unchecked Low Level Calls (DASP #4) | 52 |

## Contracts by Category

### Access Control (DASP #2)

| Contract | Vulnerable Lines | Source |
|----------|-----------------|--------|
| [FibonacciBalance.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/FibonacciBalance.sol) | 31; 38 | https://github.com/sigp/solidity-security-blog |
| [arbitrary_location_write_simple.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/arbitrary_location_write_simple.sol) | 27 | https://smartcontractsecurity.github.io/SWC-registry/docs... |
| [incorrect_constructor_name1.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/incorrect_constructor_name1.sol) | 20 | https://github.com/trailofbits/not-so-smart-contracts/blo... |
| [incorrect_constructor_name2.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/incorrect_constructor_name2.sol) | 18 | https://smartcontractsecurity.github.io/SWC-registry/docs... |
| [incorrect_constructor_name3.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/incorrect_constructor_name3.sol) | 17 | https://smartcontractsecurity.github.io/SWC-registry/docs... |
| [mapping_write.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/mapping_write.sol) | 20 | https://smartcontractsecurity.github.io/SWC-registry/docs... |
| [multiowned_vulnerable.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/multiowned_vulnerable.sol) | 38 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [mycontract.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/mycontract.sol) | 20 | https://consensys.github.io/smart-contract-best-practices... |
| [parity_wallet_bug_1.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/parity_wallet_bug_1.sol) | 223; 437 | https://github.com/paritytech/parity-ethereum/blob/4d08e7... |
| [parity_wallet_bug_2.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/parity_wallet_bug_2.sol) | 226; 233 | https://smartcontractsecurity.github.io/SWC-registry/docs... |
| [phishable.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/phishable.sol) | 20 | https://github.com/sigp/solidity-security-blog |
| [proxy.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/proxy.sol) | 19 | https://smartcontractsecurity.github.io/SWC-registry/docs... |
| [rubixi.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/rubixi.sol) | 23, 24 | https://github.com/trailofbits/not-so-smart-contracts/blo... |
| [simple_suicide.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/simple_suicide.sol) | 12, 13 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [unprotected0.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/unprotected0.sol) | 25 | https://github.com/trailofbits/not-so-smart-contracts/blo... |
| [wallet_02_refund_nosub.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/wallet_02_refund_nosub.sol) | 36 | https://smartcontractsecurity.github.io/SWC-registry/docs... |
| [wallet_03_wrong_constructor.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/wallet_03_wrong_constructor.sol) | 19, 20 | https://smartcontractsecurity.github.io/SWC-registry/docs... |
| [wallet_04_confused_sign.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/access_control/wallet_04_confused_sign.sol) | 30 | https://smartcontractsecurity.github.io/SWC-registry/docs... |

**18 contracts** in this category.

### Arithmetic / Integer Overflow (DASP #3)

| Contract | Vulnerable Lines | Source |
|----------|-----------------|--------|
| [BECToken.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/BECToken.sol) | 264 | https://smartcontractsecurity.github.io/SWC-registry/docs... |
| [insecure_transfer.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/insecure_transfer.sol) | 18 | https://consensys.github.io/smart-contract-best-practices... |
| [integer_overflow_1.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/integer_overflow_1.sol) | 14 | https://github.com/trailofbits/not-so-smart-contracts/blo... |
| [integer_overflow_add.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/integer_overflow_add.sol) | 17 | https://github.com/ConsenSys/evm-analyzer-benchmark-suite... |
| [integer_overflow_benign_1.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/integer_overflow_benign_1.sol) | 17 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [integer_overflow_mapping_sym_1.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/integer_overflow_mapping_sym_1.sol) | 16 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [integer_overflow_minimal.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/integer_overflow_minimal.sol) | 17 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [integer_overflow_mul.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/integer_overflow_mul.sol) | 17 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [integer_overflow_multitx_multifunc_feasible.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/integer_overflow_multitx_multifunc_feasible.sol) | 25 | https://github.com/ConsenSys/evm-analyzer-benchmark-suite |
| [integer_overflow_multitx_onefunc_feasible.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/integer_overflow_multitx_onefunc_feasible.sol) | 22 | https://github.com/ConsenSys/evm-analyzer-benchmark-suite |
| [overflow_simple_add.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/overflow_simple_add.sol) | 14 | https://smartcontractsecurity.github.io/SWC-registry/docs... |
| [overflow_single_tx.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/overflow_single_tx.sol) | 18; 24; 30; 36; 42; 48 | https://github.com/ConsenSys/evm-analyzer-benchmark-suite |
| [timelock.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/timelock.sol) | 22 | https://github.com/sigp/solidity-security-blog |
| [token.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/token.sol) | 20; 22 | https://github.com/sigp/solidity-security-blog |
| [tokensalechallenge.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/arithmetic/tokensalechallenge.sol) | 23; 25; 33 | https://smartcontractsecurity.github.io/SWC-registry/docs... |

**15 contracts** in this category.

### Bad Randomness (DASP #6)

| Contract | Vulnerable Lines | Source |
|----------|-----------------|--------|
| [blackjack.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/bad_randomness/blackjack.sol) | 17; 19; 21 | https://etherscan.io/address/0xa65d59708838581520511d98fb... |
| [etheraffle.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/bad_randomness/etheraffle.sol) | 49; 99; 101; 103; 114; 158 | https://etherscan.io/address/0xcC88937F325d1C6B97da0AFDbb... |
| [guess_the_random_number.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/bad_randomness/guess_the_random_number.sol) | 15 | https://capturetheether.com/challenges/lotteries/guess-th... |
| [lottery.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/bad_randomness/lottery.sol) | 38; 42 | https://etherscan.io/address/0x80ddae5251047d6ceb29765f38... |
| [lucky_doubler.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/bad_randomness/lucky_doubler.sol) | 127, 128, 129, 130; 132 | https://etherscan.io/address/0xF767fCA8e65d03fE16D4e38810... |
| [old_blockhash.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/bad_randomness/old_blockhash.sol) | 35 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [random_number_generator.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/bad_randomness/random_number_generator.sol) | 12; 18; 20; 22 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [smart_billions.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/bad_randomness/smart_billions.sol) | 523; 560; 700; 702; 704; 706; 708; 710; 712; 714; 716; 718 | https://etherscan.io/address/0x5ace17f87c7391e5792a768306... |

**8 contracts** in this category.

### Denial of Service (DASP #5)

| Contract | Vulnerable Lines | Source |
|----------|-----------------|--------|
| [auction.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/denial_of_service/auction.sol) | 23 | https://github.com/trailofbits/not-so-smart-contracts/blo... |
| [dos_address.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/denial_of_service/dos_address.sol) | 16, 17, 18 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [dos_number.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/denial_of_service/dos_number.sol) | 18, 19, 20, 21, 22 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [dos_simple.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/denial_of_service/dos_simple.sol) | 17, 18 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [list_dos.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/denial_of_service/list_dos.sol) | 46; 48 | https://etherscan.io/address/0xf45717552f12ef7cb65e95476f... |
| [send_loop.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/denial_of_service/send_loop.sol) | 24 | https://consensys.github.io/smart-contract-best-practices... |

**6 contracts** in this category.

### Front Running (DASP #7)

| Contract | Vulnerable Lines | Source |
|----------|-----------------|--------|
| [ERC20.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/front_running/ERC20.sol) | 110; 113 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [FindThisHash.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/front_running/FindThisHash.sol) | 17 | https://github.com/sigp/solidity-security-blog |
| [eth_tx_order_dependence_minimal.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/front_running/eth_tx_order_dependence_minimal.sol) | 23; 31 | https://github.com/ConsenSys/evm-analyzer-benchmark-suite |
| [odds_and_evens.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/front_running/odds_and_evens.sol) | 25; 28 | http://blockchain.unica.it/projects/ethereum-survey/attac... |

**4 contracts** in this category.

### Other / Uncategorized (DASP #10)

| Contract | Vulnerable Lines | Source |
|----------|-----------------|--------|
| [crypto_roulette.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/other/crypto_roulette.sol) | 40, 41, 42 | https://github.com/thec00n/smart-contract-honeypots/blob/... |
| [name_registrar.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/other/name_registrar.sol) | 23 | https://github.com/sigp/solidity-security-blog#storage-ex... |
| [open_address_lottery.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/other/open_address_lottery.sol) | 91 | https://etherscan.io/address/0x741f1923974464efd0aa70e778... |

**3 contracts** in this category.

### Reentrancy (DASP #1)

| Contract | Vulnerable Lines | Source |
|----------|-----------------|--------|
| [0x01f8c4e3fa3edeb29e514cba738d87ce8c091d3f.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x01f8c4e3fa3edeb29e514cba738d87ce8c091d3f.sol) | 54 | etherscan.io |
| [0x23a91059fdc9579a9fbd0edc5f2ea0bfdb70deb4.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x23a91059fdc9579a9fbd0edc5f2ea0bfdb70deb4.sol) | 38 | etherscan.io |
| [0x4320e6f8c05b27ab4707cd1f6d5ce6f3e4b3a5a1.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x4320e6f8c05b27ab4707cd1f6d5ce6f3e4b3a5a1.sol) | 55 | etherscan.io |
| [0x4e73b32ed6c35f570686b89848e5f39f20ecc106.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x4e73b32ed6c35f570686b89848e5f39f20ecc106.sol) | 54 | etherscan.io |
| [0x561eac93c92360949ab1f1403323e6db345cbf31.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x561eac93c92360949ab1f1403323e6db345cbf31.sol) | 54 | etherscan.io |
| [0x627fa62ccbb1c1b04ffaecd72a53e37fc0e17839.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x627fa62ccbb1c1b04ffaecd72a53e37fc0e17839.sol) | 94 | etherscan.io |
| [0x7541b76cb60f4c60af330c208b0623b7f54bf615.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x7541b76cb60f4c60af330c208b0623b7f54bf615.sol) | 29 | etherscan.io |
| [0x7a8721a9d64c74da899424c1b52acbf58ddc9782.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x7a8721a9d64c74da899424c1b52acbf58ddc9782.sol) | 52 | etherscan.io |
| [0x7b368c4e805c3870b6c49a3f1f49f69af8662cf3.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x7b368c4e805c3870b6c49a3f1f49f69af8662cf3.sol) | 29 | etherscan.io |
| [0x8c7777c45481dba411450c228cb692ac3d550344.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x8c7777c45481dba411450c228cb692ac3d550344.sol) | 41 | etherscan.io |
| [0x93c32845fae42c83a70e5f06214c8433665c2ab5.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x93c32845fae42c83a70e5f06214c8433665c2ab5.sol) | 29 | etherscan.io |
| [0x941d225236464a25eb18076df7da6a91d0f95e9e.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x941d225236464a25eb18076df7da6a91d0f95e9e.sol) | 44 | etherscan.io |
| [0x96edbe868531bd23a6c05e9d0c424ea64fb1b78b.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0x96edbe868531bd23a6c05e9d0c424ea64fb1b78b.sol) | 63 | etherscan.io |
| [0xaae1f51cf3339f18b6d3f3bdc75a5facd744b0b8.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0xaae1f51cf3339f18b6d3f3bdc75a5facd744b0b8.sol) | 54 | etherscan.io |
| [0xb5e1b1ee15c6fa0e48fce100125569d430f1bd12.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0xb5e1b1ee15c6fa0e48fce100125569d430f1bd12.sol) | 40 | etherscan.io |
| [0xb93430ce38ac4a6bb47fb1fc085ea669353fd89e.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0xb93430ce38ac4a6bb47fb1fc085ea669353fd89e.sol) | 38 | etherscan.io |
| [0xbaf51e761510c1a11bf48dd87c0307ac8a8c8a4f.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0xbaf51e761510c1a11bf48dd87c0307ac8a8c8a4f.sol) | 41 | etherscan.io |
| [0xbe4041d55db380c5ae9d4a9b9703f1ed4e7e3888.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0xbe4041d55db380c5ae9d4a9b9703f1ed4e7e3888.sol) | 63 | etherscan.io |
| [0xcead721ef5b11f1a7b530171aab69b16c5e66b6e.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0xcead721ef5b11f1a7b530171aab69b16c5e66b6e.sol) | 29 | etherscan.io |
| [0xf015c35649c82f5467c9c74b7f28ee67665aad68.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/0xf015c35649c82f5467c9c74b7f28ee67665aad68.sol) | 29 | etherscan.io |
| [etherbank.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/etherbank.sol) | 21 | https://github.com/seresistvanandras/EthBench/blob/master... |
| [etherstore.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/etherstore.sol) | 27 | https://github.com/sigp/solidity-security-blog |
| [modifier_reentrancy.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/modifier_reentrancy.sol) | 15 | https://github.com/SmartContractSecurity/SWC-registry/blo... |
| [reentrance.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/reentrance.sol) | 24 | https://ethernaut.zeppelin.solutions/level/0xf70706db003e... |
| [reentrancy_bonus.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/reentrancy_bonus.sol) | 28 | https://consensys.github.io/smart-contract-best-practices... |
| [reentrancy_cross_function.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/reentrancy_cross_function.sol) | 24 | https://consensys.github.io/smart-contract-best-practices... |
| [reentrancy_dao.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/reentrancy_dao.sol) | 18 | https://github.com/ConsenSys/evm-analyzer-benchmark-suite |
| [reentrancy_insecure.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/reentrancy_insecure.sol) | 17 | https://consensys.github.io/smart-contract-best-practices... |
| [reentrancy_simple.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/reentrancy_simple.sol) | 24 | https://github.com/trailofbits/not-so-smart-contracts/blo... |
| [simple_dao.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/simple_dao.sol) | 19 | http://blockchain.unica.it/projects/ethereum-survey/attac... |
| [spank_chain_payment.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/reentrancy/spank_chain_payment.sol) | 426; 430 | https://github.com/trailofbits/not-so-smart-contracts/blo... |

**31 contracts** in this category.

### Short Addresses (DASP #9)

| Contract | Vulnerable Lines | Source |
|----------|-----------------|--------|
| [short_address_example.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/short_addresses/short_address_example.sol) | 18 | https://ericrafaloff.com/analyzing-the-erc20-short-addres... |

**1 contracts** in this category.

### Time Manipulation (DASP #8)

| Contract | Vulnerable Lines | Source |
|----------|-----------------|--------|
| [ether_lotto.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/time_manipulation/ether_lotto.sol) | 43 | https://etherscan.io/address/0xa11e4ed59dc94e69612f311194... |
| [governmental_survey.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/time_manipulation/governmental_survey.sol) | 27 | http://blockchain.unica.it/projects/ethereum-survey/attac... |
| [lottopollo.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/time_manipulation/lottopollo.sol) | 13; 27 | https://github.com/seresistvanandras/EthBench/blob/master... |
| [roulette.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/time_manipulation/roulette.sol) | 18; 20 | https://github.com/sigp/solidity-security-blog |
| [timed_crowdsale.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/time_manipulation/timed_crowdsale.sol) | 13 | https://github.com/SmartContractSecurity/SWC-registry/blo... |

**5 contracts** in this category.

### Unchecked Low Level Calls (DASP #4)

| Contract | Vulnerable Lines | Source |
|----------|-----------------|--------|
| [0x07f7ecb66d788ab01dc93b9b71a88401de7d0f2e.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x07f7ecb66d788ab01dc93b9b71a88401de7d0f2e.sol) | 201; 213 | etherscan.io |
| [0x0cbe050f75bc8f8c2d6c0d249fea125fd6e1acc9.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x0cbe050f75bc8f8c2d6c0d249fea125fd6e1acc9.sol) | 12 | etherscan.io |
| [0x19cf8481ea15427a98ba3cdd6d9e14690011ab10.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x19cf8481ea15427a98ba3cdd6d9e14690011ab10.sol) | 439; 465 | etherscan.io |
| [0x2972d548497286d18e92b5fa1f8f9139e5653fd2.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x2972d548497286d18e92b5fa1f8f9139e5653fd2.sol) | 14 | etherscan.io |
| [0x39cfd754c85023648bf003bea2dd498c5612abfa.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x39cfd754c85023648bf003bea2dd498c5612abfa.sol) | 44; 97 | etherscan.io |
| [0x3a0e9acd953ffc0dd18d63603488846a6b8b2b01.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x3a0e9acd953ffc0dd18d63603488846a6b8b2b01.sol) | 44; 97 | etherscan.io |
| [0x3e013fc32a54c4c5b6991ba539dcd0ec4355c859.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x3e013fc32a54c4c5b6991ba539dcd0ec4355c859.sol) | 29 | etherscan.io |
| [0x3f2ef511aa6e75231e4deafc7a3d2ecab3741de2.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x3f2ef511aa6e75231e4deafc7a3d2ecab3741de2.sol) | 45 | etherscan.io |
| [0x4051334adc52057aca763453820cb0e045076ef3.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x4051334adc52057aca763453820cb0e045076ef3.sol) | 16 | etherscan.io |
| [0x4a66ad0bca2d700f11e1f2fc2c106f7d3264504c.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x4a66ad0bca2d700f11e1f2fc2c106f7d3264504c.sol) | 19 | etherscan.io |
| [0x4b71ad9c1a84b9b643aa54fdd66e2dec96e8b152.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x4b71ad9c1a84b9b643aa54fdd66e2dec96e8b152.sol) | 17 | etherscan.io |
| [0x524960d55174d912768678d8c606b4d50b79d7b1.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x524960d55174d912768678d8c606b4d50b79d7b1.sol) | 21 | etherscan.io |
| [0x52d2e0f9b01101a59b38a3d05c80b7618aeed984.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x52d2e0f9b01101a59b38a3d05c80b7618aeed984.sol) | 27 | etherscan.io |
| [0x5aa88d2901c68fda244f1d0584400368d2c8e739.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x5aa88d2901c68fda244f1d0584400368d2c8e739.sol) | 29 | etherscan.io |
| [0x610495793564aed0f9c7fc48dc4c7c9151d34fd6.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x610495793564aed0f9c7fc48dc4c7c9151d34fd6.sol) | 33 | etherscan.io |
| [0x627fa62ccbb1c1b04ffaecd72a53e37fc0e17839.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x627fa62ccbb1c1b04ffaecd72a53e37fc0e17839.sol) | 44 | etherscan.io |
| [0x663e4229142a27f00bafb5d087e1e730648314c3.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x663e4229142a27f00bafb5d087e1e730648314c3.sol) | 1152; 1496; 2467 | etherscan.io |
| [0x70f9eddb3931491aab1aeafbc1e7f1ca2a012db4.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x70f9eddb3931491aab1aeafbc1e7f1ca2a012db4.sol) | 29 | etherscan.io |
| [0x78c2a1e91b52bca4130b6ed9edd9fbcfd4671c37.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x78c2a1e91b52bca4130b6ed9edd9fbcfd4671c37.sol) | 45 | etherscan.io |
| [0x7a4349a749e59a5736efb7826ee3496a2dfd5489.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x7a4349a749e59a5736efb7826ee3496a2dfd5489.sol) | 44 | etherscan.io |
| [0x7d09edb07d23acb532a82be3da5c17d9d85806b4.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x7d09edb07d23acb532a82be3da5c17d9d85806b4.sol) | 198; 210 | etherscan.io |
| [0x806a6bd219f162442d992bdc4ee6eba1f2c5a707.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x806a6bd219f162442d992bdc4ee6eba1f2c5a707.sol) | 44 | etherscan.io |
| [0x84d9ec85c9c568eb332b7226a8f826d897e0a4a8.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x84d9ec85c9c568eb332b7226a8f826d897e0a4a8.sol) | 56 | etherscan.io |
| [0x89c1b3807d4c67df034fffb62f3509561218d30b.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x89c1b3807d4c67df034fffb62f3509561218d30b.sol) | 162; 175; 180; 192 | etherscan.io |
| [0x8fd1e427396ddb511533cf9abdbebd0a7e08da35.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x8fd1e427396ddb511533cf9abdbebd0a7e08da35.sol) | 44; 97 | etherscan.io |
| [0x958a8f594101d2c0485a52319f29b2647f2ebc06.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x958a8f594101d2c0485a52319f29b2647f2ebc06.sol) | 55 | etherscan.io |
| [0x9d06cbafa865037a01d322d3f4222fa3e04e5488.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0x9d06cbafa865037a01d322d3f4222fa3e04e5488.sol) | 54; 65 | etherscan.io |
| [0xa1fceeff3acc57d257b917e30c4df661401d6431.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xa1fceeff3acc57d257b917e30c4df661401d6431.sol) | 31 | etherscan.io |
| [0xa46edd6a9a93feec36576ee5048146870ea2c3ae.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xa46edd6a9a93feec36576ee5048146870ea2c3ae.sol) | 16 | etherscan.io |
| [0xb0510d68f210b7db66e8c7c814f22680f2b8d1d6.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xb0510d68f210b7db66e8c7c814f22680f2b8d1d6.sol) | 69; 71; 73; 75; 102 | etherscan.io |
| [0xb11b2fed6c9354f7aa2f658d3b4d7b31d8a13b77.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xb11b2fed6c9354f7aa2f658d3b4d7b31d8a13b77.sol) | 14 | etherscan.io |
| [0xb37f18af15bafb869a065b61fc83cfc44ed9cc27.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xb37f18af15bafb869a065b61fc83cfc44ed9cc27.sol) | 33 | etherscan.io |
| [0xb620cee6b52f96f3c6b253e6eea556aa2d214a99.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xb620cee6b52f96f3c6b253e6eea556aa2d214a99.sol) | 100; 106; 133 | etherscan.io |
| [0xb7c5c5aa4d42967efe906e1b66cb8df9cebf04f7.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xb7c5c5aa4d42967efe906e1b66cb8df9cebf04f7.sol) | 25 | etherscan.io |
| [0xbaa3de6504690efb064420d89e871c27065cdd52.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xbaa3de6504690efb064420d89e871c27065cdd52.sol) | 14 | etherscan.io |
| [0xbebbfe5b549f5db6e6c78ca97cac19d1fb03082c.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xbebbfe5b549f5db6e6c78ca97cac19d1fb03082c.sol) | 14 | etherscan.io |
| [0xd2018bfaa266a9ec0a1a84b061640faa009def76.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xd2018bfaa266a9ec0a1a84b061640faa009def76.sol) | 44 | etherscan.io |
| [0xd5967fed03e85d1cce44cab284695b41bc675b5c.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xd5967fed03e85d1cce44cab284695b41bc675b5c.sol) | 16 | etherscan.io |
| [0xdb1c55f6926e7d847ddf8678905ad871a68199d2.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xdb1c55f6926e7d847ddf8678905ad871a68199d2.sol) | 39 | etherscan.io |
| [0xe09b1ab8111c2729a76f16de96bc86a7af837928.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xe09b1ab8111c2729a76f16de96bc86a7af837928.sol) | 150 | etherscan.io |
| [0xe4eabdca81e31d9acbc4af76b30f532b6ed7f3bf.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xe4eabdca81e31d9acbc4af76b30f532b6ed7f3bf.sol) | 44 | etherscan.io |
| [0xe82f0742a71a02b9e9ffc142fdcb6eb1ed06fb87.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xe82f0742a71a02b9e9ffc142fdcb6eb1ed06fb87.sol) | 39 | etherscan.io |
| [0xe894d54dca59cb53fe9cbc5155093605c7068220.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xe894d54dca59cb53fe9cbc5155093605c7068220.sol) | 17 | etherscan.io |
| [0xec329ffc97d75fe03428ae155fc7793431487f63.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xec329ffc97d75fe03428ae155fc7793431487f63.sol) | 30 | etherscan.io |
| [0xf2570186500a46986f3139f65afedc2afe4f445d.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xf2570186500a46986f3139f65afedc2afe4f445d.sol) | 18 | etherscan.io |
| [0xf29ebe930a539a60279ace72c707cba851a57707.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xf29ebe930a539a60279ace72c707cba851a57707.sol) | 16 | etherscan.io |
| [0xf70d589d76eebdd7c12cc5eec99f8f6fa4233b9e.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/0xf70d589d76eebdd7c12cc5eec99f8f6fa4233b9e.sol) | 44 | etherscan.io |
| [etherpot_lotto.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/etherpot_lotto.sol) | 109; 141 | https://github.com/etherpot/contract/blob/master/app/cont... |
| [king_of_the_ether_throne.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/king_of_the_ether_throne.sol) | 110; 118; 132; 174 | https://github.com/kieranelby/KingOfTheEtherThrone/blob/v... |
| [lotto.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/lotto.sol) | 20; 27 | https://github.com/sigp/solidity-security-blog |
| [mishandled.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/mishandled.sol) | 14 | https://github.com/seresistvanandras/EthBench/blob/master... |
| [unchecked_return_value.sol](https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/unchecked_low_level_calls/unchecked_return_value.sol) | 17 | https://smartcontractsecurity.github.io/SWC-registry/docs... |

**52 contracts** in this category.



## Key Vulnerability Patterns

### Reentrancy (DASP #1)
- State changes after external calls (check-effects-interactions violation)
- `call.value()` followed by state updates
- Cross-function reentrancy via shared state

### Arithmetic (DASP #3)
- Integer overflow/underflow in Solidity < 0.8.0 without SafeMath
- Unchecked arithmetic in token transfers and balance calculations

### Access Control (DASP #2)
- Missing access modifiers on critical functions
- Incorrect constructor names (pre-0.4.22)
- `tx.origin` used for authorization instead of `msg.sender`
- Unprotected `selfdestruct` / `delegatecall`

### Denial of Service (DASP #5)
- Unbounded loops over user-controlled arrays
- External call failures blocking contract execution
- Gas limit exhaustion via push-based payments

### Bad Randomness (DASP #6)
- `block.timestamp`, `block.difficulty`, `blockhash` used for randomness
- Predictable seed values from on-chain data

### Front Running (DASP #7)
- Transaction ordering dependence
- Unprotected `approve` + `transferFrom` pattern in ERC20

### Unchecked Low Level Calls (DASP #4)
- Return value of `send()`, `call()`, `delegatecall()` not checked
- Silent failures in ETH transfers

### Time Manipulation (DASP #8)
- `block.timestamp` dependence for critical logic
- Miner-manipulable time windows

## Usage

Reference a specific vulnerable contract:
```
https://github.com/smartbugs/smartbugs-curated/blob/master/dataset/{category}/{filename}
```
