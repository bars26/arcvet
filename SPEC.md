# ArcVet — SPEC (formula frozen `arcvet-v1.0`)

Same philosophy as ProofGraph's `SPEC.md`: deterministic, public, explainable,
**advisory — not a guarantee**. This document is the source of truth for the scoring
formula. Every term below was checked against real Arc Testnet launches
(`lolpad.fun`) before being weighted — see `DECISIONS.md` §3–4 for the evidence.

## 1. Scope

Phase 1: score a single **token address** on Arc, fully automatically, from on-chain
history only. No submitted evidence, no registry of our own. Works from minute one
of a token's life (with a correspondingly low `confidence`).

## 2. Inputs (`TokenSignals`) — computed by the read layer, not by the formula

```ts
type OwnerProbeResult = "no-admin" | "renounced" | "live-owner";

type TokenSignals = {
  tokenAgeHours: number;              // hours since the first Transfer(0x0 -> ...)
  transferCount: number;              // total Transfer events observed for the token
  totalSupply: bigint;
  topEoaHolder: { address: `0x${string}`; balance: bigint } | null;
  // ^ largest holder that is a plain EOA (eth_getCode == "0x"), excluding the token
  //   contract itself and the burn address. null if no EOA holds a nonzero balance
  //   (e.g. everything still sits in a contract — a pool, a curve, a vesting
  //   contract) OR if the holders read failed — see holderDataAvailable below.
  holderDataAvailable: boolean;
  // ^ false means the upstream holders endpoint itself failed (DECISIONS.md §11 —
  //   confirmed real: arc-scan.org's /v1/tokens/{addr}/holders returned an internal
  //   error for a real token). topEoaHolder is null in that case too, but for a
  //   different reason (unknown, not "checked and found none") — holderConcentration
  //   must be dropped, not scored as if concentration were fine.
  creator: `0x${string}`;
  creatorEarlyAcquired: bigint;       // amount the creator acquired via transfers IN,
  // ^ from any counterparty, within EARLY_WINDOW_HOURS (24h) of the mint event.
  deployerPriorLaunches7d: number;    // # token-like contracts this deployer created
  // ^ in the 7 days strictly before this token's own creation block.
  verified: boolean;                  // arcscan getsourcecode has a non-empty SourceCode
  ownerProbe: OwnerProbeResult;       // result of calling the raw owner() selector
};
```

The read layer is expected to fetch these by pulling **all** `Transfer` logs for the
token via the arcscan API and reconstructing balances/timing client-side — see
`DECISIONS.md` §3 item 2: the API's `topic1`-filtered mint query silently returns
nothing, so don't rely on server-side topic filtering.

## 3. Terms, weights, and why (frozen)

| term | weight | why this weight |
|---|---|---|
| `holderConcentration` | **0.40** | The one signal that caught a real, materially wrong "safe" reading in manual testing (RABBIT: 63% in an unlabelled EOA behind a "Graduated, LP Locked Forever" badge). Highest weight because it's the most validated and the one the platform's own UI doesn't surface. |
| `creatorEarlyAccumulation` | **0.25** | Launchpad-specific insider-timing signal, also confirmed on real data (the same RABBIT creator bought ~20% of supply in 3 buys within hours of mint). Distinct from raw concentration — this is about *how* a position was built, not just its size. |
| `deployerLaunchVelocity` | **0.20** | Real and cheap (confirmed: one creator launched 2 of our 4 sample tokens), but Phase 1 has no outcome-tracking for those prior launches yet (did they die? were they fine?) — so it's weighted below the two directly-observed risk signals, not above them. |
| `ownershipSurface` | **0.10** | Real but binary and, for clone-factory launches, largely uniform (confirmed: all 4 lolpad samples had no owner at all) — informative but rarely the deciding factor for this launch venue. |
| `verification` | **0.05** | Confirmed non-discriminating for factory-clone launches (all 4 samples unverified) but still meaningful for bespoke contracts (Knidos' hand-written vault was verified) — kept at low weight rather than dropped, so it can't dominate a score it usually has nothing to say about. |

Weights sum to 1.00. **No dispute-penalty multiplier in Phase 1** — there is no
submitted-evidence / dispute concept yet (that's the candidate Phase 2 layer). The
result type reserves a `penalty` field, fixed at `0`, so adding one later isn't a
breaking change.

## 4. Term values (each normalised to 0..1, higher = safer)

```
holderConcentration:
  topEoaShare = topEoaHolder ? topEoaHolder.balance / totalSupply : 0
  value = clamp(1 - topEoaShare / 0.5, 0, 1)
  // 0% in any single EOA -> 1 (best). >=50% in one EOA -> 0 (worst, capped there).
  applicable when transferCount > 0 AND holderDataAvailable
  // (nothing to measure on a zero-transfer token, or when the holders read failed)

creatorEarlyAccumulation:
  earlyShare = creatorEarlyAcquired / totalSupply
  value = clamp(1 - earlyShare / 0.2, 0, 1)
  // creator acquiring 0% early -> 1 (best). >=20% in the first 24h -> 0 (worst).
  applicable when tokenAgeHours >= 1 (too early to say anything before that)

deployerLaunchVelocity:
  value = clamp(1 - deployerPriorLaunches7d / 3, 0, 1)
  // 0 prior launches in 7 days -> 1 (best, and a first-time deployer is NOT
  // penalised just for being new). 3+ in 7 days -> 0 (spray-and-pray pattern).
  always applicable

ownershipSurface:
  value = ownerProbe === "live-owner" ? 0.4 : 1
  // "no-admin" (owner() reverts - no such function) and "renounced" (owner() ==
  // address(0)) both score 1: neither exposes a live privileged-call surface.
  // A real, live owner address scores 0.4, not 0 - having an owner isn't proof of
  // intent to rug, just a real attack surface that concentration/timing don't cover.
  always applicable

verification:
  value = verified ? 1 : 0.5
  // unverified is NOT scored as risky (0) - Day-1 testing showed ~all clone-factory
  // launches are unverified by convention, not by suspicion. 0.5 = "no signal".
  always applicable
```

## 5. Aggregation

```
base    = Σ(value · weight for applicable terms) / Σ(weight for applicable terms)
penalty = 0                         // reserved, see §3
score   = round(100 · base · (1 - penalty))
```

If **no** term is applicable (only possible if `transferCount === 0` and
`tokenAgeHours < 1`, i.e. the token is brand new with zero activity):
`score = null`, `confidence = "none"` — do not print a 0, that would read as
"confirmed bad" rather than "nothing to measure yet".

## 6. Confidence

```
transferCount === 0                                  -> "none"
tokenAgeHours < 24  OR transferCount < 5              -> "low"
tokenAgeHours < 24*7 OR transferCount < 20            -> "medium"
otherwise                                             -> "high"
```

A token can score numerically well and still carry `low` confidence — a 5-minute-old
token with no history yet simply hasn't had time to reveal a problem. `reasons[]`
must say so explicitly (mirrors ProofGraph's "advisory, not a guarantee").

## 7. `reasons[]` (one line per applicable term, plus confidence)

Example, for a token matching the real RABBIT case:

```
"Largest non-pool holder owns 62.96% of supply — a plain wallet, not a contract"
"Creator acquired 18.98% of supply within 24h of launch"
"Deployer launched 1 other token in the 7 days around this one"
"No owner()/admin function detected on this contract"
"Contract is not verified on arcscan (common for clone-factory launches)"
"Confidence: medium (3 days old, 25 transfers)"
```

## 8. Reference values (sanity anchors, real data)

These formula weights and caps were derived and frozen while ArcVet still read
**Arc Testnet** — since `DECISIONS.md §9-10`, the live app reads **Arc, chain 5042**
(the real network) instead. The formula itself didn't change; only the data source
did. Kept for both, since they anchor different things:

- **RABBIT** (lolpad.fun, Arc **Testnet**, graduated, "LP Locked Forever"):
  topEoaShare ≈ 0.630, creatorEarlyShare ≈ 0.190, 1 prior launch from the same
  deployer, no owner, unverified → **score = 27, confidence medium**
  (`scripts/fixture-rabbit.ts` — a pure `scoreToken` unit test, still runs
  regardless of which chain the read layer targets) — correctly flagged as risky
  despite the platform's own "graduated / locked" badge. `DECISIONS.md §4`.
- **WARP** (circlewarp.fun's own token, Arc **chain 5042**, 44 days old, 10,834
  transfers, 1097 holders): topEoaShare ≈ 0.026, no early creator accumulation, no
  owner, unverified (nothing on chain 5042 is verified yet — `DECISIONS.md §9`) →
  **score = 75, confidence high** (`npx tsx scripts/check-token.ts`, live).
- **Argus** (a TollyLabs token, chain 5042, 232h old): topEoaShare ≈ 0.030, a live
  owner address, deployer launched 28 other tokens in the surrounding 7 days →
  **score = 69, confidence high**. `DECISIONS.md §10`.
- **BARC / sharc attac / VORT** (3 real, currently-crashing chain 5042 tokens
  found on RadarDex's live leaderboard, −55% to −56% 24h at time of check, 1-2
  days old): scored **96\*** (BARC, only 4 terms — holder data unavailable, see
  `holderDataAvailable` in §2), **88** (sharc attac), **75** (VORT), all
  medium confidence — **none flagged as risky**. Not proof any of the three is a
  rug: price decline alone isn't evidence of malicious intent. But it confirms a
  real, previously-known gap (this section historically carried "liquidity
  lock/pull: not wired up") — every current term reads ERC-20 state, none read
  DEX pool/price dynamics, so a rug mechanism playing out through the pool would
  be invisible here regardless of what actually happened to these three.
  `DECISIONS.md §11`. A follow-up attempt to add a generic liquidity signal
  (`DECISIONS.md §12`) was tried and paused — the natural candidate signal (a
  token's mint recipient identifies its pool) only holds for one launchpad
  template and breaks on others, the same lesson `KNOWN_LAUNCH_FACTORIES`
  already forced: no shortcut, only per-platform work.

## 9. Versioning

`formulaVersion = "arcvet-v1.0"`. Bumped on any weight, cap, or term change.
Phase 2 (community-submitted evidence, ProofGraph-style) is additive — a new,
separate term/registry, not a rewrite of this formula.
