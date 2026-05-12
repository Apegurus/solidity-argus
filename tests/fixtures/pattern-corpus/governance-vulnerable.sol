// SPDX-License-Identifier: MIT
// PATTERN: governance | EXPECTED: POSITIVE (should trigger)
pragma solidity ^0.8.0;

/// @dev Vulnerable governance contract — multiple governance anti-patterns
/// Based on real exploit patterns: Beanstalk, Build Finance DAO, Audius
contract VulnerableGovernor {
    struct Proposal {
        uint256 id;
        address proposer;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        address[] targets;
        bytes[] calldatas;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(address => mapping(uint256 => bool)) public hasVoted;
    uint256 public proposalCount;
    IERC20 public token;

    // VULN: timelock-bypass — execute without timelock delay
    function execute(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.forVotes > proposal.againstVotes, "Not passed");
        require(!proposal.executed, "Already executed");
        proposal.executed = true;
        for (uint256 i = 0; i < proposal.targets.length; i++) {
            (bool success, ) = proposal.targets[i].call(proposal.calldatas[i]);
            require(success, "Execution failed");
        }
    }

    // VULN: flash-loan-governance — propose without snapshot-based power
    function propose(
        address[] calldata targets,
        bytes[] calldata calldatas,
        string calldata description
    ) external returns (uint256) {
        uint256 id = ++proposalCount;
        proposals[id].id = id;
        proposals[id].proposer = msg.sender;
        proposals[id].targets = targets;
        proposals[id].calldatas = calldatas;
        return id;
    }

    // VULN: flash-loan-governance — castVote without snapshot
    function castVote(uint256 proposalId, bool support) external {
        require(!hasVoted[msg.sender][proposalId], "Already voted");
        hasVoted[msg.sender][proposalId] = true;
        // VULN: quorum-manipulation — using live balance, not snapshot
        uint256 weight = getVotes(msg.sender);
        if (support) {
            proposals[proposalId].forVotes += weight;
        } else {
            proposals[proposalId].againstVotes += weight;
        }
    }

    // VULN: quorum-manipulation — live balance query, no snapshot
    function getVotes(address account) public view returns (uint256) {
        return token.balanceOf(account);
    }

    // VULN: single-step-governance — no state machine lifecycle
    function executeProposal(uint256 proposalId) public {
        Proposal storage proposal = proposals[proposalId];
        require(proposal.forVotes > proposal.againstVotes, "Not passed");
        proposal.executed = true;
        for (uint256 i = 0; i < proposal.targets.length; i++) {
            (bool success, ) = proposal.targets[i].call(proposal.calldatas[i]);
            require(success);
        }
    }
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}
