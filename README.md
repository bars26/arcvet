# ArcVet

**A trust scanner for token launches and their deployers on Arc — no submitted evidence
required.**

Paste a token or deployer address. ArcVet reads the deployer's on-chain launch history
and the token's own risk signals (mint authority, ownership, holder concentration,
launch velocity) directly from Arc, and returns an explainable 0–100 score with a
`reasons[]` breakdown — the same "advisory, not a guarantee" philosophy as
[ProofGraph](https://github.com/bars26/proofgraph), applied to "should I ape into this."
No DEX-liquidity signal yet — tried and paused, `DECISIONS.md §12`.

Phase 1: fully automatic, on-chain only. No registry, no manual evidence submission
— works from block zero for any address. Phase 2 adds an optional, wallet-signed
community-report layer on top — **advisory only, never blended into the score**
(`PHASE2.md`).

**Live:** https://arcvet-bars26s-projects.vercel.app

See `DECISIONS.md` for scope, open questions, and Day-1 findings; `SPEC.md` for the
frozen scoring formula; `LAUNCHPADS.md` for recon on Arc's live launchpads; `PHASE2.md`
for the community-evidence layer's design and why it stays separate from the score.

## Development

```bash
npm install
npm run dev
```
