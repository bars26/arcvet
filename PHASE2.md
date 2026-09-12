# ArcVet Phase 2 — community evidence layer

_Discussed with the user before writing any code (same discipline as Phase 1's
`DECISIONS.md`) — the one decision that mattered most was settled first and is
frozen: **community reports never feed `scoreToken` (score.ts, formula
arcvet-v1.0)**. Everything below builds on that, not around it._

## Why not just do what ProofGraph did

ProofGraph's `EvidenceRegistryV2` is a real on-chain registry, openly scored into
the formula, with sybil resistance explicitly punted to "V3, out of scope." Copying
that shape here was the default instinct — and wrong, for two concrete reasons:

1. **The stakes are inverted.** ProofGraph scores *agents* for hire — moderate
   stakes, and the people most likely to game a score aren't usually the ones
   being scored. ArcVet scores *tokens people are about to put real USDC into*,
   on Arc's real production chain (chain 5042, `DECISIONS.md §9`). The person with
   the single strongest incentive to manipulate a token's score is that token's own
   deployer — and a competitor has a real incentive to falsely tank a rival's. A
   ProofGraph-style "punt sybil resistance to later" stance is far riskier here.
2. **Phase 1's automatic score is the thing worth protecting.** It's deterministic,
   validated against real cases (WARP 75, Argus 69, RABBIT 27 — SPEC.md §8), and
   hard to fake because it only reads facts already on-chain. Blending in
   unweighted community sentiment before any real anti-sybil design exists would
   make that whole number gameable on day one.

So Phase 2 keeps the automatic score untouched and adds a **separate, clearly
advisory** layer instead — visible, useful, but never silently folded into the
number people are actually trusting.

## What community evidence is *for*

Not re-stating what Phase 1 already measures on-chain. The gap it fills is
specifically what automatic, on-chain-only signals structurally cannot see:

- off-chain facts (team went dark, socials deleted right after graduation);
- a deeper code finding a generic probe misses (a disguised admin function under a
  non-standard selector, an upgradeable-proxy trick `probeOwner`'s raw `owner()`
  call wouldn't catch);
- cross-referencing identity across addresses ("this team rugged before, under a
  different wallet") — hard to prove on-chain, valuable if a human verifies it.

## Storage: off-chain first, on purpose

ProofGraph went straight to a contract because it deployed to *testnet* play-money.
Arc chain 5042 is real — a wrong schema or a bug in our own registry contract would
be a real, permanent cost. Phase 2 starts the same way ProofGraph itself did
(V1 simple, V2 structured on-chain once proven) — off-chain first, a contract is
the natural next step once the report shape and a real anti-sybil design are
proven, not a surprise pivot.

Storage started as a plain JSON file (same disk pattern as Phase 1's `cache.ts`,
but durable data rather than an expiring cache) — fine for local dev, not durable
across a serverless redeploy or shared across instances. Migrated to Upstash Redis
(the "Vercel KV" product — `src/lib/reportStore.ts`, `@upstash/redis`) ahead of the
first real deploy; same schema, same rate-limit semantics, now backed by one shared
instance across dev/preview/production. A stake/bond anti-sybil model (below)
remains the next real step, not this one.

## Anti-sybil, v1: a signature, not a stake

The frozen decision above (doesn't touch the score) already removes the worst
incentive to attack this layer — gaming a display-only report list is much less
valuable than gaming the number people actually act on. Given that, the bar for v1
is a floor, not a ceiling:

- **Every report must be signed** by the reporter's own wallet (EIP-191
  `personal_sign` over a canonical message — `src/lib/evidence.ts`,
  `buildReportMessage`). Verified server-side with `viem`'s `verifyMessage`
  (pure ECDSA recovery, no RPC call needed). This doesn't prove a reporter is
  telling the truth, only that a real, specific wallet is willing to attach its
  name to the claim — cheap sybil (many fresh wallets) is still possible, but
  free-form anonymous spam isn't.
- **Rate-limited**: 5 reports/reporter/day (`reportStore.ts`,
  `MAX_REPORTS_PER_REPORTER_PER_DAY`), a Redis counter keyed by reporter + UTC
  date — a real global limit now (shared across all serverless instances), not
  the per-instance approximation the file-based version gave.
- **A stake/bond model** (put up USDC, lose it if the report is later disputed as
  false) is a real candidate for v2 of this layer, once report volume shows
  whether pure signature + rate-limit is actually being abused. Not built now —
  the schema (`ReportInput`) doesn't block adding it later.

## Schema (frozen for v1 — `src/lib/evidence.ts`)

```ts
type ReportCategory = "rug_pull" | "honeypot" | "hidden_backdoor"
                     | "team_disappeared" | "confirmed_legit" | "other";

type ReportInput = {
  subject: Address;       // the token or deployer address being reported
  reporter: Address;      // claimed signer — verified against the signature
  category: ReportCategory;
  description: string;    // free text, max 2000 chars
  evidenceUri?: string;   // optional link — screenshot, tx, thread
  timestamp: number;      // unix seconds, part of the signed message
};
```

The signed message format (`buildReportMessage`) is frozen the same way
`formulaVersion` is — changing field order or wording invalidates every signature
verified against the old format.

## What was built

- `src/lib/evidence.ts` — pure: message format, structural validation
  (`validateReportInput`), signature verification (`verifyReportSignature`). No I/O.
- `src/lib/reportStore.ts` — file-backed storage + the daily rate-limit counter.
- `src/app/api/reports/route.ts` — `GET ?subject=` (list), `POST` (submit: validate
  shape → rate-limit check → verify signature → store). A submission with a bad
  category/timestamp gets 400, a stale/reused/tampered/impersonated signature gets
  401, rate-limited gets 429 — never a silent 200.
- `src/app/CommunityReports.tsx` — client component: lists existing reports for the
  address being viewed; a "Report this address" form that requests the browser's
  injected wallet (`window.ethereum`, raw EIP-1193 — no wallet-connection library,
  same minimal-dependency approach as the rest of ArcVet), signs with
  `personal_sign`, and submits. Explicitly labelled "Advisory only — not scored" in
  the UI itself, not just in this doc.
- Wired into `src/app/page.tsx` under the existing score panel, keyed on the
  checked address so switching tokens resets the report list cleanly.

**Verified end to end** (`scripts/test-report.ts` — a throwaway wallet signing
exactly the way a browser wallet would, since a headless test environment has no
real injected provider to click through):
1. a validly signed report is accepted and stored — PASS
2. it's readable back via `GET /api/reports?subject=` — PASS
3. a tampered signature is rejected (401) — PASS
4. an impersonation attempt (signing correctly, then claiming a *different* address
   as the reporter) is rejected (401) — PASS
5. a 6th report from the same reporter in one day is rate-limited (429) — PASS

Confirmed live in the browser too: the panel renders reports with category badges,
short reporter addresses, dates, and evidence links; the report form is present and
correctly gated behind "Advisory only — not scored" messaging.

## Explicitly not done here

- No on-chain registry yet (see "Storage" above — deliberate, not a gap).
- No stake/bond, no dispute/counter-report mechanism, no moderation/curation pass.
- No weighting or aggregation of reports into anything score-shaped — they're shown
  raw, newest first, full stop.
- No detection of duplicate/near-duplicate reports from sybil'd fresh wallets —
  the rate limit slows this down, it doesn't solve it.
