# ArcVet

**A trust scanner for token launches and their deployers on Arc — no submitted evidence
required.**

Paste a token or deployer address. ArcVet reads the deployer's on-chain launch history
and the token's own risk signals (mint authority, ownership, holder concentration,
liquidity status) directly from Arc, and returns an explainable 0–100 score with a
`reasons[]` breakdown — the same "advisory, not a guarantee" philosophy as
[ProofGraph](https://github.com/bars26/proofgraph), applied to "should I ape into this."

Phase 1 (this repo, MVP): fully automatic, on-chain only. No registry, no manual
evidence submission — works from block zero for any address. A community-evidence
layer (ProofGraph-style: outcome + verifier + hash) is a candidate Phase 2, once the
automatic signal is proven useful.

See `DECISIONS.md` for scope, open questions, and Day-1 findings; `SPEC.md` for the
frozen scoring formula; `LAUNCHPADS.md` for recon on Arc's live launchpads (which
ones are real, which factory patterns they use) ahead of widening Phase 2.

## Development

```bash
npm install
npm run dev
```
