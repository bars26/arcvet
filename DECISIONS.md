# ArcVet — Decisions & Day 1 verification

_Started 2026-09-12, alongside ProofGraph. Same working style: verify against live Arc
Testnet before designing anything, freeze scope, then build._

## 0. Why this exists

Arc's own pitch is institutional stablecoin infra, but the community on `community.arc.io`
is overwhelmingly chasing token launches, NFT drops, and memecoins — "how do I make money
with a little capital." Mainnet is Sep 16, 2026 — right when launch activity (and scam
activity) on a new chain typically spikes. ArcVet answers the question that crowd actually
asks: **is this token / this deployer safe to touch?**

Reuses the ProofGraph philosophy (explainable, deterministic, "advisory not a guarantee",
`reasons[]` per score) but **not** its architecture 1:1 — ProofGraph needs someone to
`submitEvidence`; ArcVet's Phase 1 must work with **zero submitted evidence**, from
on-chain history alone, so it has a score for a token five minutes after launch.

## 1. Scope decision — Phase 1 (this repo)

**Fully automatic, read-only, no contract of our own.** Given a token address (or a
deployer address), compute a score from:

- **Deployer track record** — how many tokens has this address deployed before, what
  happened to them (still has holders/liquidity vs. abandoned/zeroed out).
- **Contract risk flags** — mint authority still live, ownership renounced or not,
  proxy/upgradeable (rug-via-upgrade risk), standard vs. modified ERC-20.
- **Holder concentration** — top-holder share of supply, holder count trend.
- **Liquidity status** — does it have a live DEX pool, is it locked, has it been drained.
- **Age / recency** — same half-life idea as ProofGraph's recency term.

**Explicitly deferred to a possible Phase 2:** community-submitted evidence
(ProofGraph-style `{ outcome, verifier, hash, uri }` registry) layered on top once
Phase 1's automatic signal is proven to say something real.

## 2. Day 1 — open questions to verify on live Arc Testnet (no assumptions yet)

1. Can we enumerate **every contract a given address has deployed**? (arcscan API
   `txlist` filtered to contract-creation txs, or a dedicated endpoint?)
2. Given a token contract, can we get **holder list / count / top-holder concentration**?
   (Blockscout-style APIs don't always expose this the way Etherscan's does — public RPC
   prunes `Transfer` logs per ProofGraph's Day-1 finding, so log-scanning may not work here
   either.)
3. Is there a **DEX / AMM live on Arc Testnet** at all? If not, "liquidity locked/pulled"
   isn't measurable yet and the formula must drop that term (or wait for one to exist by
   mainnet).
4. For a token contract, can we tell **mint authority / ownership status** cheaply? Only
   if the contract is verified (arcscan `getsourcecode` returns ABI) — per ProofGraph's
   own Arc feedback, most contracts on Arc testnet are **not** verified. Need a fallback
   for unverified contracts (bytecode signature match against common patterns, or just
   surface "unverified" as a risk flag itself).
5. What does a **known-good** token (e.g. Arc USDC) and a handful of real community
   launch tokens (from the Ecosystem Showcase board) actually look like against these
   checks — do the signals separate "looks fine" from "looks sketchy" in practice?

Findings go below as they're confirmed — nothing in §1's formula is frozen until these
are answered.

## 3. Day 1 findings

_(pending)_
