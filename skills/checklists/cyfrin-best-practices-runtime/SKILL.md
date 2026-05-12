---
name: cyfrin-best-practices-runtime
description: Cyfrin best-practice checklist focused on runtime heuristics, cross-chain concerns, and timelock controls
category: checklist
---
<!-- Source: Cyfrin/audit-checklist -->
<!-- Auto-generated from https://github.com/Cyfrin/audit-checklist -->

# Cyfrin Audit Checklist — Best Practices (Runtime & Cross-chain)

### Basics > Version Issues > Solidity Version Issues

- [ ] **[SOL-Basics-VI-SVI-1]** Does the contract encode storage structs or arrays with types under 32 bytes directly using experimental ABIEncoderV2? (version 0.5.0~0.5.6)
  - Storage structs and arrays with types shorter than 32 bytes can cause data corruption if encoded directly from storage using the experimental ABIEncoderV2.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2019/03/26/solidity-optimizer-and-abiencoderv2-bug/

- [ ] **[SOL-Basics-VI-SVI-2]** Are there any instances where empty strings are directly passed to function calls? (version ~0.4.11)
  - If an empty string is used in a function call, the following function arguments will not be correctly passed to the function.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-3]** Does the optimizer replace specific constants with alternative computations? (version ~0.4.10)
  - In some situations, the optimizer replaces certain numbers in the code with routines that compute different numbers.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2017/05/03/solidity-optimizer-bug/

- [ ] **[SOL-Basics-VI-SVI-4]** Does the contract use `abi.encodePacked`, especially in hash generation? (version >= 0.8.17)
  - If you use `keccak256(abi.encodePacked(a, b))` and both `a` and `b` are dynamic types, it is easy to craft collisions in the hash value by moving parts of `a` into `b` and vice-versa. More specifically, `abi.encodePacked(\'a\', \'bc\') == abi.encodePacked(\'ab\', \'c\').
  - **Remediation:** Use `abi.encode` instead of `abi.encodePacked`.
  - **References:**
    - https://solodit.xyz/issues/m-1-abiencodepacked-allows-hash-collision-sherlock-nftport-nftport-git
    - https://docs.soliditylang.org/en/v0.8.17/abi-spec.html?highlight=collisions#non-standard-packed-mode

- [ ] **[SOL-Basics-VI-SVI-5]** BUILD: Is the contract optimized using sequences containing FullInliner with non-expression-split code? (version 0.6.7~0.8.20)
  - Optimizer sequences containing FullInliner do not preserve the evaluation order of arguments of inlined function calls in code that is not in expression-split form.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2023/07/19/full-inliner-non-expression-split-argument-evaluation-order-bug/

- [ ] **[SOL-Basics-VI-SVI-6]** Are there any functions that conditionally terminate inside an inline assembly? (version 0.8.13~0.8.16)
  - Calling functions that conditionally terminate the external EVM call using the assembly statements ``return(...)`` or ``stop()`` may result in incorrect removals of prior storage writes.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2022/09/08/storage-write-removal-before-conditional-termination/

- [ ] **[SOL-Basics-VI-SVI-7]** Are tuples containing a statically-sized calldata array at the end being ABI-encoded? (version 0.5.8~0.8.15)
  - ABI-encoding a tuple with a statically-sized calldata array in the last component would corrupt 32 leading bytes of its first dynamically encoded component.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2022/08/08/calldata-tuple-reencoding-head-overflow-bug/

- [ ] **[SOL-Basics-VI-SVI-8]** Does the contract have functions that copy `bytes` arrays from memory or calldata directly to storage? (version 0.0.1~0.8.14)
  - Copying ``bytes`` arrays from memory or calldata to storage may result in dirty storage values.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2022/06/15/dirty-bytes-array-to-storage-bug/

- [ ] **[SOL-Basics-VI-SVI-9]** Is there a function with multiple inline assembly blocks? (version 0.8.13~0.8.14)
  - The Yul optimizer may incorrectly remove memory writes from inline assembly blocks, that do not access solidity variables.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2022/06/15/inline-assembly-memory-side-effects-bug/

- [ ] **[SOL-Basics-VI-SVI-10]** Is a nested array being ABI-encoded or passed directly to an external function? (version 0.5.8~0.8.13)
  - ABI-reencoding of nested dynamic calldata arrays did not always perform proper size checks against the size of calldata and could read beyond `calldatasize()`.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2022/05/17/calldata-reencode-size-check-bug/

- [ ] **[SOL-Basics-VI-SVI-11]** Is `abi.encodeCall` used together with fixed-length bytes literals? (version 0.8.11~0.8.12)
  - Literals used for a fixed length bytes parameter in ``abi.encodeCall`` were encoded incorrectly.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2022/03/16/encodecall-bug/

- [ ] **[SOL-Basics-VI-SVI-12]** Is there any user defined types based on types shorter than 32 bytes? (version =0.8.8)
  - User defined value types with underlying type shorter than 32 bytes used incorrect storage layout and wasted storage
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2021/09/29/user-defined-value-types-bug/

- [ ] **[SOL-Basics-VI-SVI-13]** Is there an immutable variable of signed integer type shorter than 256 bits? (version 0.6.5~0.8.8)
  - Immutable variables of signed integer type shorter than 256 bits can lead to values with invalid higher order bits if inline assembly is used.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2021/09/29/signed-immutables-bug/

- [ ] **[SOL-Basics-VI-SVI-14]** Is there any use of `abi.encode` on memory with multi-dimensional array or structs? (version 0.4.16~0.8.3)
  - If used on memory byte arrays, result of the function ``abi.decode`` can depend on the contents of memory outside of the actual byte array that is decoded.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2021/04/21/decoding-from-memory-bug/

- [ ] **[SOL-Basics-VI-SVI-15]** Is there an inline assembly block with `keccak256` inside? (version ~0.8.2)
  - The bytecode optimizer incorrectly re-used previously evaluated Keccak-256 hashes. You are unlikely to be affected if you do not compute Keccak-256 hashes in inline assembly.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2021/03/23/keccak-optimizer-bug/

- [ ] **[SOL-Basics-VI-SVI-16]** Is there a copy of an empty `bytes` or `string` from `memory` or `calldata` to `storage`? (version ~0.7.3)
  - Copying an empty byte array (or string) from memory or calldata to storage can result in data corruption if the target array's length is increased subsequently without storing new data.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2020/10/19/empty-byte-array-copy-bug/

- [ ] **[SOL-Basics-VI-SVI-17]** Is there a dynamically-sized storage-array with types of size at most 16 bytes? (version ~0.7.2)
  - When assigning a dynamically-sized array with types of size at most 16 bytes in storage causing the assigned array to shrink, some parts of deleted slots were not zeroed out.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2020/10/07/solidity-dynamic-array-cleanup-bug/

- [ ] **[SOL-Basics-VI-SVI-18]** Does the library use contract types in events? (version 0.5.0~0.5.7)
  - Contract types used in events in libraries cause an incorrect event signature hash
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-19]** Does the contract use internal library functions with calldata parameters via `using for`? (version =0.6.9)
  - Function calls to internal library functions with calldata parameters called via ``using for`` can result in invalid data being read.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-20]** Are string literals with double backslashes passed directly to external or encoding functions with ABIEncoderV2 enabled? (version 0.5.14~0.6.7)
  - String literals containing double backslash characters passed directly to external or encoding function calls can lead to a different string being used when ABIEncoderV2 is enabled.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-21]** Does the contract access slices of dynamic arrays, especially multi-dimensional ones? (version 0.6.0~0.6.7)
  - Accessing array slices of arrays with dynamically encoded base types (e.g. multi-dimensional arrays) can result in invalid data being read.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-22]** Is there a contract with creation code, no constructor, but a base with a constructor that accepts non-zero values? (version 0.4.5~0.6.7)
  - The creation code of a contract that does not define a constructor but has a base that does define a constructor did not revert for calls with non-zero value.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-23]** Does the contract create extremely large memory arrays? (version 0.2.0~0.6.4)
  - The creation of very large memory arrays can result in overlapping memory regions and thus memory corruption.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2020/04/06/memory-creation-overflow-bug/

- [ ] **[SOL-Basics-VI-SVI-24]** Does the contract's inline assembly with Yul optimizer use assignments inside for loops combined with continue or break? (version =0.6.0)
  - The Yul optimizer can remove essential assignments to variables declared inside for loops when Yul's continue or break statement is used. You are unlikely to be affected if you do not use inline assembly with for loops and continue and break statements.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-25]** Does the contract allow private methods to be overridden by inheriting contracts? (version 0.3.0~0.5.16)
  - Private methods can be overridden by inheriting contracts.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-26]** Is there any Yul's continue or break statement inside the loop?? (version 0.5.8~0.5.15)
  - The Yul optimizer can remove essential assignments to variables declared inside for loops when Yul's continue or break statement is used. You are unlikely to be affected if you do not use inline assembly with for loops and continue and break statements.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-27]** Are both experimental ABIEncoderV2 and Yul optimizer activated? (version =0.5.14)
  - If both the experimental ABIEncoderV2 and the experimental Yul optimizer are activated, one component of the Yul optimizer may reuse data in memory that has been changed in the meantime.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-28]** Does the contract read from calldata structs with dynamic yet statically-sized members? (version 0.5.6~0.5.10)
  - Reading from calldata structs that contain dynamically encoded, but statically-sized members can result in incorrect values.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-29]** Does the contract assign arrays of signed integers to differently typed storage arrays? (version 0.4.7~0.5.9)
  - Assigning an array of signed integers to a storage array of different type can lead to data corruption in that array.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2019/06/25/solidity-storage-array-bugs/

- [ ] **[SOL-Basics-VI-SVI-30]** Does the contract directly encode storage arrays with structs or static arrays in external calls or abi.encode*? (version 0.4.16~0.5.9)
  - Storage arrays containing structs or other statically-sized arrays are not read properly when directly encoded in external function calls or in abi.encode*.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2019/06/25/solidity-storage-array-bugs/

- [ ] **[SOL-Basics-VI-SVI-31]** Does the contract's constructor accept structs or arrays with dynamic arrays? (version 0.4.16~0.5.8)
  - A contract's constructor that takes structs or arrays that contain dynamically-sized arrays reverts or decodes to invalid data.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-32]** Are uninitialized internal function pointers created in the constructor being called? (version 0.5.0~0.5.7)
  - Calling uninitialized internal function pointers created in the constructor does not always revert and can cause unexpected behavior.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-33]** Are uninitialized internal function pointers created in the constructor being called? (version 0.4.5~0.4.25)
  - Calling uninitialized internal function pointers created in the constructor does not always revert and can cause unexpected behavior.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-34]** Does the library use contract types in events? (version 0.3.0~0.4.25)
  - Contract types used in events in libraries cause an incorrect event signature hash
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-35]** Does the contract encode storage structs or arrays with types under 32 bytes directly using experimental ABIEncoderV2? (version 0.4.19~0.4.25)
  - Storage structs and arrays with types shorter than 32 bytes can cause data corruption if encoded directly from storage using the experimental ABIEncoderV2.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2019/03/26/solidity-optimizer-and-abiencoderv2-bug/

- [ ] **[SOL-Basics-VI-SVI-36]** Does the contract's optimizer handle byte opcodes with a second argument of 31 or an equivalent constant expression? (version 0.5.5~0.5.6)
  - The optimizer incorrectly handles byte opcodes whose second argument is 31 or a constant expression that evaluates to 31. This can result in unexpected values.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2019/03/26/solidity-optimizer-and-abiencoderv2-bug/

- [ ] **[SOL-Basics-VI-SVI-37]** Are there double bitwise shifts with large constants that might sum up to overflow 256 bits? (version =0.5.5)
  - Double bitwise shifts by large constants whose sum overflows 256 bits can result in unexpected values.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2019/03/26/solidity-optimizer-and-abiencoderv2-bug/

- [ ] **[SOL-Basics-VI-SVI-38]** Is the ** operator used with an exponent type shorter than 256 bits? (version ~0.4.24)
  - Using the ** operator with an exponent of type shorter than 256 bits can result in unexpected values.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2018/09/13/solidity-bugfix-release/

- [ ] **[SOL-Basics-VI-SVI-39]** Are structs used in the logged events? (version 0.4.17~0.4.24)
  - Using structs in events logged wrong data.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2018/09/13/solidity-bugfix-release/

- [ ] **[SOL-Basics-VI-SVI-40]** Are functions returning multi-dimensional fixed-size arrays called? (version 0.1.4~0.4.21)
  - Calling functions that return multi-dimensional fixed-size arrays can result in memory corruption.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2018/09/13/solidity-bugfix-release/

- [ ] **[SOL-Basics-VI-SVI-41]** Does the contract use both new-style and old-style constructors simultaneously? (version =0.4.22)
  - If a contract has both a new-style constructor (using the constructor keyword) and an old-style constructor (a function with the same name as the contract) at the same time, one of them will be ignored.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-42]** Is there a function name crafted to potentially override the fallback function execution? (version ~0.4.17)
  - It is possible to craft the name of a function such that it is executed instead of the fallback function in very specific circumstances.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-43]** Is the low-level .delegatecall() used without checking the actual execution outcome? (version 0.3.0~0.4.14)
  - The low-level .delegatecall() does not return the execution outcome, but converts the value returned by the functioned called to a boolean instead.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-44]** Is the ecrecover() function used without validating its input? (version ~0.4.13)
  - The ecrecover() builtin can return garbage for malformed input.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-45]** Is the `.selector` member accessed on complex expressions? (version 0.6.2~0.8.20)
  - Accessing the ``.selector`` member on complex expressions leaves the expression unevaluated in the legacy code generation.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2023/07/19/missing-side-effects-on-selector-access-bug/

- [ ] **[SOL-Basics-VI-SVI-46]** Is there any inconsistency (`memory` vs `calldata`) in the param type during inheritance? (version 0.6.9~0.8.13)
  - It was possible to change the data location of the parameters or return variables from ``calldata`` to ``memory`` and vice-versa while overriding internal and public functions. This caused invalid code to be generated when calling such a function internally through virtual function calls.
  - **Remediation:** Use the latest Solidity version.
  - **References:**
    - https://blog.soliditylang.org/2022/05/17/data-location-inheritance-bug/

- [ ] **[SOL-Basics-VI-SVI-47]** Are there any functions with the same name and parameter type inside the same contract? (version =0.7.1)
  - The compiler does not flag an error when two or more free functions with the same name and parameter types are defined in a source unit or when an imported free function alias shadows another free function with a different name but identical parameter types.
  - **Remediation:** Use the latest Solidity version.

- [ ] **[SOL-Basics-VI-SVI-48]** Does the contract use tuple assignments with multi-stack-slot components, like nested tuples or dynamic calldata references? (version 0.1.6~0.6.5)
  - Tuple assignments with components that occupy several stack slots, i.e. nested tuples, pointers to external functions or references to dynamically sized calldata arrays, can result in invalid values.
  - **Remediation:** Use the latest Solidity version.

### Hash / Merkle Tree

- [ ] **[SOL-HMT-1]** Is the Merkle tree vulnerable to front-running attacks?
  - When using a merkle tree, the new proof is calculated at a certain time and there exists a period of time between when the proof is generated and the proof is published.
  - **Remediation:** Ensure that front-running the merkle proof setting does not affect the protocol.

- [ ] **[SOL-HMT-2]** Does the claim method validate `msg.sender`?
  - Validation of `msg.sender` is critical in the use of Merkle tree.
  - **Remediation:** Ensure that the `msg.sender` is actually the same address included in the leave.

- [ ] **[SOL-HMT-3]** What is the result when passing a zero hash to the Merkle tree functions?
  - Passing the zero hash can lead to unintended behaviors or vulnerabilities if not properly handled.
  - **Remediation:** Implement checks to handle zero hash values appropriately and prevent potential misuse.

- [ ] **[SOL-HMT-4]** What occurs if the same proof is duplicated within the Merkle tree?
  - Duplicate proofs within a Merkle tree can lead to double-spending or other vulnerabilities.
  - **Remediation:** Ensure the Merkle tree construction and verification process detects and prevents the use of duplicate proofs.

- [ ] **[SOL-HMT-5]** Are the leaves of the Merkle tree hashed with the claimable address included?
  - Not including claimable addresses when hashing leaves can let an attacker to claim.
  - **Remediation:** Ensure that the Merkle tree construction includes the hashing of claimable addresses within the leaves.

### Heuristics

- [ ] **[SOL-Heuristics-1]** Is there any logic implemented multiple times?
  - Inconsistent implementations of the same logic can introduce errors or vulnerabilities.
  - **Remediation:** Standardize the logic and make it as a separate function.

- [ ] **[SOL-Heuristics-2]** Does the contract use any nested structures?
  - If a variable of nested structure is deleted, only the top-level fields are reset by default values (zero) and the nested level fields are not reset.
  - **Remediation:** Always ensure that inner fields are deleted before the outer fields of the structure.

- [ ] **[SOL-Heuristics-3]** Is there any unexpected behavior when `src==dst` (or `caller==receiver`)?
  - Overlooking the possibility of a sender and a recipient (source and destination) being the same in smart contracts can lead to unintended problems.
  - **Remediation:** Ensure the protocol behaves as expected when `src==dst`.

- [ ] **[SOL-Heuristics-4]** Is the NonReentrant modifier placed before every other modifier?
  - The order of modifiers can influence the behavior of a function. Generally,  NonReentrant must come first than other modifiers.
  - **Remediation:** Reorder modifiers so that NonReentrant is placed before other modifiers.

- [ ] **[SOL-Heuristics-6]** Did you check the relevant EIP recommendations and security concerns?
  - Incomplete or incorrect implementation of EIP recommendations can lead to vulnerabilities.
  - **Remediation:** Read the recommendations and security concerns and ensure all are implemented as per the official recommendations.

- [ ] **[SOL-Heuristics-7]** Are there any off-by-one errors?
  - Off-by-one errors are not rare. Is `<=` correct in this context or should `<` be used? Should a variable be set to the length of a list or the length - 1? Should an iteration start at 1 or 0?
  - **Remediation:** Review all usages of comparison operators for correctness.

- [ ] **[SOL-Heuristics-8]** Are logical operators used correctly?
  - Logical operators like `==`, `!=`, `&&`, `||`, `!` can be overlooked especially when the test coverage is not good.
  - **Remediation:** Review all usages of logical operators for correctness.

- [ ] **[SOL-Heuristics-9]** What happens if the protocol's contracts are inputted as if they are normal actors?
  - Supplying unexpected addresses can lead to unintended behaviors, especially if the address points to another contract inside the same protocol.
  - **Remediation:** Implement checks to validate receiver addresses and ensure the protocol behaves as expected.

- [ ] **[SOL-Heuristics-10]** Are there rounding errors that can be amplified?
  - While minor rounding errors can be inevitable in certain operations, they can pose significant issues if they can be magnified. Amplification can occur when a function is invoked multiple times strategically or under specific conditions.
  - **Remediation:** Conduct thorough tests to identify and understand potential rounding errors. Ensure that they cannot be amplified to a level that would be detrimental to the system or its users. In cases where significant rounding errors are detected, the implementation should be revised to minimize or eliminate them.
  - **References:**
    - https://github.com/OpenCoreCH/smart-contract-audits/blob/main/reports/c4/rigor.md#high-significant-rounding-errors-for-interest-calculation

- [ ] **[SOL-Heuristics-11]** Is there any uninitialized state?
  - Checking a variable against its default value might be used to detect initialization. If such defaults can also be valid state, it could lead to vulnerabilities.
  - **Remediation:** Avoid solely relying on default values to determine initialization status.

- [ ] **[SOL-Heuristics-12]** Can functions be invoked multiple times with identical parameters?
  - Functions that should be unique per parameters set might be callable multiple times, leading to potential issues.
  - **Remediation:** Ensure functions have measures to prevent repeated calls with identical or similar parameters, especially when these calls can produce adverse effects.

- [ ] **[SOL-Heuristics-13]** Is the global state updated correctly?
  - While working with a `memory` copy for optimization, developers might overlook updating the global state.
  - **Remediation:** Always ensure the global state mirrors changes made in `memory`. Consider tools or extensions that can highlight discrepancies.

- [ ] **[SOL-Heuristics-14]** Is ETH/WETH handling implemented correctly?
  - Contracts might have special logic for ETH, like wrapping to WETH. Assuming exclusivity between handling ETH and WETH without checks can introduce errors.
  - **Remediation:** Clearly differentiate the logic between ETH and WETH handling, ensuring no overlap or mutual exclusivity assumptions without validation.

- [ ] **[SOL-Heuristics-15]** Does the protocol put any sensitive data on the blockchain?
  - Data on the blockchain, including that marked 'private' in smart contracts, is visible to anyone who knows how to query the blockchain's state or analyze its transaction history. Private variables are not exempt from public inspection.
  - **Remediation:** Sensitive data should either be kept off-chain or encrypted before being stored on-chain. It's important to manage encryption keys securely and ensure that on-chain data does not expose private information even when encrypted, if the encryption method is weak or the keys are mishandled.

- [ ] **[SOL-Heuristics-16]** Are there any code asymmetries?
  - In many projects, there should be some symmetries for different functions. For instance, a `withdraw` function should (usually) undo all the state changes of a `deposit` function and a `delete` function should undo all the state changes of the corresponding `add` function. Asymmetries in these function pairs (e.g., forgetting to unset a field or to subtract from a value) can often lead to undesired behavior. Sometimes one side of a 'pair' is missing, like missing removing from a whitelist while there is a function to add to a whitelist.
  - **Remediation:** Review paired functions for symmetry and ensure they counteract each other's state changes appropriately.
  - **References:**
    - https://github.com/OpenCoreCH/smart-contract-auditing-heuristics#code-asymmetries

- [ ] **[SOL-Heuristics-17]** Does calling a function multiple times with smaller amounts yield the same contract state as calling it once with the aggregate amount?
  - Associative properties of certain financial operations suggest that performing the operation multiple times with smaller amounts should yield an equivalent outcome as performing it once with the aggregate amount. Variations might be indicative of potential issues such as rounding errors, unintended fee accumulations, or other inconsistencies.
  - **Remediation:** Implement tests to validate consistency. Where discrepancies exist, ensure they are intentional, minimal, and well-documented. If discrepancies are unintended, reevaluate the implementation to ensure precision and correctness.

### Multi-chain/Cross-chain

- [ ] **[SOL-McCc-1]** Are there assumption of consistency in the `block.number` or `block.timestamp` across chains?
  - Block time can vary across different chains, leading to potential timing discrepancies.
  - **Remediation:** Avoid comparing timestamp or block numbers for different chains.
  - **References:**
    - https://solodit.cyfrin.io/issues/m-06-l1xrenzobridge-and-l2xrenzobridge-uses-the-blocktimestamp-as-dependency-which-can-cause-issues-code4rena-renzo-renzo-git

- [ ] **[SOL-McCc-2]** Has the protocol been checked for the target chain differences?
  - Understanding the differences between chains is vital for ensuring compatibility and preventing unexpected behaviors.
  - **Remediation:** Regularly check for chain differences and update the protocol accordingly.
  - **References:**
    - https://www.evmdiff.com/diff?base=1&target=10
    - https://github.com/0xJuancito/multichain-auditor#differences-from-ethereum

- [ ] **[SOL-McCc-3]** Are the EVM opcodes and operations used by the protocol compatible across all targeted chains?
  - Incompatibility can arise when the protocol uses EVM operations not supported on certain chains.
  - **Remediation:** Review and ensure compatibility for chains like Arbitrum and Optimism.
  - **References:**
    - https://docs.arbitrum.io/solidity-support
    - https://community.optimism.io/docs/developers/build/differences/#transaction-costs

- [ ] **[SOL-McCc-4]** Does the expected behavior of `tx.origin` and `msg.sender` remain consistent across all deployment chains?
  - Different chains might interpret these values differently, leading to unexpected behaviors.
  - **Remediation:** Test and verify the behavior on all targeted chains.
  - **References:**
    - https://community.optimism.io/docs/developers/build/differences/#opcode-differences

- [ ] **[SOL-McCc-6]** Is there consistency in ERC20 decimals across chains?
  - Decimals in ERC20 tokens can differ across chains.
  - **Remediation:** Ensure consistent ERC20 decimals or implement chain-specific adjustments.
  - **References:**
    - https://github.com/0xJuancito/multichain-auditor#erc20-decimals

- [ ] **[SOL-McCc-7]** Have contract upgradability implications been evaluated on different chains?
  - Contracts may have different upgradability properties depending on the chain, like USDT being upgradable on Polygon but not on Ethereum.
  - **Remediation:** Verify and document upgradability characteristics for each chain.

- [ ] **[SOL-McCc-8]** Have cross-chain messaging implementations been thoroughly reviewed for permissions and functionality?
  - Cross-chain messaging requires robust security checks to ensure the correct permissions and intended functionality.
  - **Remediation:** Double check the access control over cross-chain messaging components.

- [ ] **[SOL-McCc-9]** Is there a whitelist of compatible chains?
  - Allowing messages from an unsupported chain can lead to unpredictable results.
  - **Remediation:** Implement a whitelist to prevent messages from unsupported chains.

- [ ] **[SOL-McCc-10]** Have contracts been checked for compatibility when deployed to the zkSync Era?
  - zkSync Era might have specific requirements or differences when compared to standard Ethereum deployments.
  - **Remediation:** Review and ensure compatibility before deploying contracts to zkSync Era.
  - **References:**
    - https://era.zksync.io/docs/reference/architecture/differences-with-ethereum.html

- [ ] **[SOL-McCc-11]** Is block production consistency ensured?
  - Inconsistent block production can lead to unexpected application behaviors.
  - **Remediation:** Develop with the assumption that block production may not always be consistent.

- [ ] **[SOL-McCc-12]** Is `PUSH0` opcode supported for Solidity version `>=0.8.20`?
  - `PUSH0` might not be supported on all chains, leading to potential incompatibility issues.
  - **Remediation:** Ensure if `PUSH0` is supported in the target chain.
  - **References:**
    - https://github.com/0xJuancito/multichain-auditor#support-for-the-push0-opcode

- [ ] **[SOL-McCc-13]** Are there any attributes attached to the bridged assets?
  - When assets (e.g. tokens) are bridged across chains, the relevant attributes (e.g. approval) must be bridged or reset accordingly.
  - **Remediation:** Ensure accounting all the relevant attributes when assets are bridged.
  - **References:**
    - https://solodit.cyfrin.io/issues/not-update-rewards-in-handleincomingupdate-function-of-sdlpoolprimary-leads-to-incorrect-reward-calculations-codehawks-stakelink-git

### Timelock

- [ ] **[SOL-Timelock-1]** Are timelocks implemented for important changes?
  - Immediate changes in the protocol can affect the users.
  - **Remediation:** Implement timelocks for important changes, allowing users adequate time to respond to proposed alterations.

