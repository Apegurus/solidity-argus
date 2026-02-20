// SPDX-License-Identifier: MIT
// PATTERN: governance | EXPECTED: NEGATIVE (should NOT trigger)
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

/// @dev Safe governance contract — follows OpenZeppelin Governor patterns
/// Uses snapshot-based voting, timelock, proposal threshold, and state machine
contract SafeGovernor is Governor, GovernorVotes, GovernorTimelockControl {

    uint256 private _votingDelay;
    uint256 private _votingPeriod;
    uint256 private _proposalThreshold;

    constructor(
        IVotes _token,
        TimelockController _timelock
    )
        Governor("SafeGovernor")
        GovernorVotes(_token)
        GovernorTimelockControl(_timelock)
    {
        _votingDelay = 1 days;
        _votingPeriod = 1 weeks;
        _proposalThreshold = 100_000e18;
    }

    // SAFE: proposalThreshold enforces minimum token holding
    function proposalThreshold() public view override returns (uint256) {
        return _proposalThreshold;
    }

    // SAFE: inherited propose requires proposalThreshold check
    // SAFE: inherited castVote uses getPastVotes (snapshot-based)
    // SAFE: inherited execute goes through timelock queue + delay

    function votingDelay() public view override returns (uint256) {
        return _votingDelay;
    }

    function votingPeriod() public view override returns (uint256) {
        return _votingPeriod;
    }

    function quorum(uint256 blockNumber) public view override returns (uint256) {
        // SAFE: uses getPastTotalSupply — snapshot-based quorum
        return token().getPastTotalSupply(blockNumber) * 4 / 100;
    }

    // SAFE: state machine enforced by Governor base — state() checks
    // Pending -> Active -> Succeeded -> Queued -> Executed

    // SAFE: uses supportsInterface for proper ERC165 compliance
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

/// @dev Another safe pattern: internal governance helper with proper checks
contract GovernanceUtils {
    mapping(uint256 => mapping(address => uint256)) public snapshotVotes;

    // SAFE: uses Checkpoint-based historical lookup
    function getVotingPower(address account, uint256 snapshotId) internal view returns (uint256) {
        // Uses snapshot — not live balance
        return snapshotVotes[snapshotId][account];
    }

    // SAFE: internal function, not externally callable
    function _processVote(address voter, uint256 proposalId, bool support) internal {
        // Internal only — not a governance entry point
    }
}
