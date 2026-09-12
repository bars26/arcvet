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

## 3. Day 1 findings (verified live against `testnet.arcscan.app/api` + `rpc.testnet.arc.network`)

Ground truth used: ProofGraph's own `EvidenceRegistryV2` (`0x99848Ff9…`), whose deployer
(`0x4f80b5c4…`) and creation block (`60005144`) we already know for certain — so every
API answer below was checked against a fact we control, not guessed at.

1. **Deployer → list of created contracts: YES, via `account/txlist`, with a caveat.**
   `getcontractcreation` (given a contract) reliably returns `{ contractCreator,
   blockNumber, creationBytecode }` — confirmed exact match. The reverse (given a
   deployer, list what they created) is **not** a dedicated endpoint; you paginate
   `account/txlist` for the address and keep entries where `contractAddress` is
   non-empty (a creation tx has no `to` field at all in the response, `contractAddress`
   holds the new address). Confirmed: the known creation tx surfaced correctly once
   queried by its actual block range — an unfiltered "last 50 txs, desc" page simply
   didn't happen to include it, because the deployer does plenty of ordinary transfers
   too. **Design consequence:** for a low-activity deployer wallet (typical of a
   one-off launch, which is our real target) this is cheap (a few pages); for a very
   active address it could take many pages — cap/paginate defensively.
2. **Mint / transfer history: YES, via `logs/getLogs` on arcscan, even though the raw
   RPC won't hold it (ProofGraph's Day-1 finding holds here too).** `topic0 = Transfer`
   (+ `topic1 = 0x0` for mint-only) returned 667 real events for EURC instantly. So
   **holder concentration at mint time is computable** cheaply; full current-balance
   reconstruction (paginating *every* transfer) is heavier but doable for a young
   token with a realistic transfer count.
3. **`tokenholderlist` / `tokeninfo`: NOT supported** (`"Unknown action"`) on this
   Blockscout instance — unlike Etherscan, there's no ready-made "top holders" call.
   Must reconstruct concentration from raw Transfer/mint logs ourselves (finding 2).
4. **Contract verification is a genuine mixed bag, not "testnet = never verified."**
   EURC (Circle's own) and a real community launch (Knidos' vault) are **both
   verified** on arcscan; ProofGraph's own `EvidenceRegistryV2` is **not**. So
   "verified?" is a real, checkable, non-trivial signal per contract — not something
   we can assume either way.
5. **Ownership/admin checks work generically even without an ABI**, by calling the
   raw 4-byte selector directly (`eth_call` with `data: 0x8da5cb5b` = `owner()`),
   no verification needed:
   - `EvidenceRegistryV2` → reverts (correct — it deliberately has no admin, per
     ProofGraph's own `THREAT-MODEL.md`).
   - EURC proxy → returns a real owner address.
   - Knidos vault → reverts with a *custom* reason ("Native token transfers are not
     allowed"), i.e. inconclusive for `owner()` specifically but still an informative,
     concrete response rather than silence.
   **Design consequence:** probe a short list of common selectors (`owner()`,
   `renounceOwnership` existence via bytecode grep, `mint(address,uint256)` selector
   presence in bytecode) generically; don't require verification for a baseline signal.
6. **Rate limiting is real.** One burst of probing hit `"Too many requests. Increase
   limits now at https://dev.blockscout.com"` on the public arcscan API. **Design
   consequence:** ArcVet must cache per-address results and query on-demand (like
   ProofGraph does), not bulk-crawl. No API key path investigated yet — treat as a
   possible V1.1 if the public rate limit turns out too tight for real usage.
7. **Live DEX / liquidity-lock check: NOT investigated yet.** No known Arc-testnet
   AMM address in hand. Until we find one (or confirm there isn't one worth checking
   yet), the formula's "liquidity" term stays **not applicable** — dropped via the
   same applicability-aware renormalization ProofGraph's `score.ts` already uses,
   not faked with a placeholder value.

### What this means for the Phase 1 formula (not frozen yet, but now evidence-based)

Realistically computable today, per (token or deployer) address, with no submitted
evidence and no API key:
- deployer track record (count + age of prior launches, via txlist pagination)
- mint-time holder concentration (via getLogs on Transfer-from-0x0)
- verification status (getsourcecode)
- generic ownership/admin-function probing (raw selector calls)
- contract age / recency

Not yet available (drop or defer, don't fake):
- liquidity lock/pull status (no known DEX to check against yet)
- a ready-made top-holder list (must be reconstructed, not fetched)

## 4. Manual test against real launches (lolpad.fun, 2026-09-12)

[lolpad.fun](https://lolpad.fun) is a live fair-launch bonding-curve platform on Arc
Testnet ("No code, no liquidity to seed, no rug" — pairs a meme against USDC or a
tokenized stock; graduates to its own DEX, **LolSwap**, when the curve fills). This
answers Day-1 open question 3: **there is a DEX on Arc** (LolSwap) — the liquidity
term doesn't have to stay dropped forever, it's just not wired up in Phase 1 yet.

Applied the Phase-1 signal list by hand to 4 real graduated tokens (RABBIT, lol,
ARCAT, CATTY — two of them, RABBIT + CATTY, from the *same* repeat creator
`0x80b4…895f`; ARCAT's creator happens to be ProofGraph's own long-lived deployer
wallet, a known-legitimate reference point).

**Two signals turned out not to discriminate at all for this launch venue — drop
them for lolpad-style tokens specifically:**
- `getsourcecode` verification: **all 4 unverified.** lolpad clones a template
  contract per launch; nobody verifies the clone. Verification only meant something
  for the *other* kind of launch we checked earlier (Knidos' hand-written vault, which
  was verified) — it's a signal for bespoke contracts, not factory clones.
- generic `owner()` probe: **reverts on all 4**, consistent with lolpad's own
  marketing ("NO DEV UNLOCK") — the template has no owner/admin at all. Uniform
  across the sample, so useless as a discriminator here (would still matter for a
  hand-rolled token with a mint backdoor).

**One assumption was wrong and fixed:** querying `logs/getLogs` with
`topic1=<32-byte-zero>` to isolate mint events returned **0 results** even though a
real `Transfer(0x0 → …)` mint event demonstrably exists (confirmed by pulling *all*
Transfer events for the token and looking at the first one chronologically). The
topic-AND filter parameters on this API don't behave as expected — **don't rely on
them; pull all Transfer logs for the token (cheap — 25 events total for RABBIT) and
filter/reconstruct client-side instead.**

**What actually showed up, reconstructing full balances from all 25 transfers:**

| holder | % of supply | is a contract? |
|---|---|---|
| `0x8f9da437…52451` | **62.96%** | **no — plain EOA** |
| `0x80b4…895f` (the *labelled* creator) | 14.23% | no |
| `0x87d948f9…c6706` | 10.65% | not checked |
| `0x9c9501…bc449` (creator of a *different* lolpad token, "lol") | 8.34% | no |
| `0x4f80b5c4…406bf` (ProofGraph's own deployer wallet) | 3.21% | no |

This is a genuinely useful, non-obvious finding: **a single wallet that isn't even
the token's labelled creator holds 63% of a token lolpad's own UI marks "Graduated ✓
100%, LP Locked Forever."** The mint recipient (the bonding-curve escrow contract,
confirmed via `eth_getCode`) net-settled to near-zero — consistent with a fully
"graduated" curve — but that doesn't mean supply ended up decentralized; it means it
ended up concentrated in one EOA instead. **The platform's own graduation badge does
not surface this. This is exactly the gap ArcVet exists to fill**, not a re-statement
of what the launchpad already shows.

Also visible in the raw transfer log: the labelled creator bought from the bonding
curve **three times in the first ~20,000 blocks after mint** (~19% of supply) before
buying/selling again later — an early-insider-accumulation pattern that's a real,
launchpad-specific signal, distinct from generic "holder concentration."

### Revised Phase 1 signal list (evidence-based, not the original guess)

| Signal | Status |
|---|---|
| Top-holder concentration (reconstructed from full Transfer log, not the failed topic filter) | ✅ keep — real signal, confirmed non-trivial on live data |
| Top holder is an EOA vs. a contract (`eth_getCode`) | ✅ **add** — without this, a locked-in-a-pool 63% and a whale-owned-63% look identical; they're opposite risk levels |
| Creator's own early post-mint buys from the curve | ✅ **add** — launchpad-specific insider-accumulation signal, visible directly in the transfer log |
| Deployer track record (repeat launches) | ✅ keep — confirmed real (0x80b4…895f made 2 of our 4 samples) |
| Contract verification (`getsourcecode`) | ⚠️ keep but **conditional** — non-discriminating for factory-clone launches (all unverified), still meaningful for bespoke/hand-written contracts (Knidos was verified) |
| Generic `owner()` / admin probe | ⚠️ keep but conditional — same reasoning, uniform "no owner" across an entire clone-factory's output |
| Liquidity lock/pull via LolSwap | 🔜 not wired up yet, but now known feasible — LolSwap exists |

## 5. BLOCKER — public arcscan API rate limit is much tighter than assumed

Wiring the real read layer (`src/lib/arc.ts` + `tokenSignals.ts`) to run
end-to-end against RABBIT hit a hard wall immediately: after this session's Day-1/4
manual probing, the anonymous arcscan API is now fully rate-limited. Confirmed via
response headers on a single, isolated diagnostic call:

```
HTTP/2 429
x-ratelimit-limit: 10
x-ratelimit-remaining: 0
x-ratelimit-reset: 75393        (seconds — ≈ 20.9 hours)
body: {"message":"Too many requests. Increase limits now at
       https://dev.blockscout.com","result":null,"status":"0"}
```

**This is a materially different situation from ProofGraph's Day-1 finding.**
ProofGraph hit "the public RPC prunes history" and worked around it by moving log
queries to arcscan's API — arcscan itself was fine there because ProofGraph's actual
per-query call volume was low (a handful of reads per score, cached implicitly by
the UI's request cadence). ArcVet's `getTokenSignals` needs ~5-8 arcscan calls per
token (creation lookup, full transfer log, verification, deployer's created-contracts
list, ...), and evidently **10 requests total is the anonymous ceiling for a ~21h
window** — not per-minute, per-hour-ish, or bursty. One real end-to-end check can
exhaust it; a live product doing this per visitor cannot function against the
anonymous tier as built.

**Implication — this needs a decision before the read layer can be validated live,
let alone shipped:** either (a) find/obtain an authenticated arcscan/Blockscout API
key with a materially higher limit (`dev.blockscout.com` is referenced directly in
the error), (b) re-check whether the *raw RPC* actually has more log retention than
ProofGraph's finding assumed for *recent* (not full-history) ranges, which would let
us serve recent-token checks from the RPC and reserve arcscan calls for the
deployer-history lookup only, or (c) build a small self-hosted cache/indexer so a
given token/deployer is only ever queried once against arcscan, not once per visitor.

Code (`arc.ts`, `tokenSignals.ts`, `score.ts`, fixtures) is written and typechecks
clean, but **not yet validated against live data** — the RABBIT fixture (§4,
`scripts/fixture-rabbit.ts`) proves the formula's arithmetic; `scripts/check-token.ts`
proves nothing yet because it can't complete a run right now.

## 6. Resolution — the heaviest call was moved off arcscan entirely, and it's real

Re-checked the "public RPC prunes history" assumption directly (ProofGraph's Day-1
finding, taken at face value in §3 above) using **only the raw RPC** — zero arcscan
calls, so this cost none of the exhausted budget. Result: **that assumption was too
strong.** The RPC doesn't prune the logs; a single unbounded `eth_getLogs` call fails
on *response size* (`"HTTP response body exceeded the size limit"`) and on *request
rate* (`code -32005 "rate limit exceeded"`) — both fixable by chunking block ranges
and spacing requests out, not signs the data is gone.

`getAllTransfers` (`src/lib/arc.ts`) was rewritten to page through the raw RPC in
(adaptively-shrinking) block-range chunks with a retry-backoff on the RPC's own rate
limit, instead of arcscan's `logs/getLogs`. **Validated end to end against RABBIT
with zero arcscan calls: found all 25 transfers, an exact match against arcscan's
count from §4** — same events, same order, same amounts. Took 216.6s for RABBIT
specifically (~415,000 blocks from creation to head, because RABBIT is already
several days old by Arc's block rate) — a token checked within its first hours or
day of life, Phase 1's actual target, spans a tiny fraction of that and should
resolve in a few seconds.

## 7. UI + API shipped, validated live end-to-end (2026-09-12)

`src/app/api/check/route.ts` (`GET /api/check?address=0x…`) and `src/app/page.tsx`
(paste-an-address UI, three real lolpad presets, term bars + reasons, matching
ProofGraph's `/v2` polish level). Ran a real check through the actual UI against
RABBIT: **score 36, confidence medium, age 61.0h, 25 transfers, top EOA 63.0%** —
consistent with §4/§6's manually-verified numbers (the 18.98% early-accumulation
reason line matches exactly). `deployerLaunchVelocity` came back "0 prior launches"
live, rather than the "1" assumed by hand in §4/§8 — real data, more accurate than
the guess (CATTY may have been created outside the 7-day-before-RABBIT window, or
missed by the capped `txlist` pagination — not confirmed either way).

One open, unconfirmed discrepancy: this live run reported the contract **verified**,
where the direct §3/§4 check found it unverified. Not chased further given the tight
arcscan budget — plausible explanation is Blockscout auto-verifying a byte-identical
clone once a sibling lolpad-template contract got verified elsewhere, but that's a
guess, not a confirmed mechanism.

**Net effect on the arcscan-only blocker in §5:** the only calls that still have no
RPC equivalent are `getcontractcreation` (who deployed it + when — 1 call) and the
deployer's created-contracts lookup (`account/txlist`, paginated — typically 1 call
for a low-activity deployer) and `getsourcecode` (verification — 1 call). **A full
`getTokenSignals` run now costs ~3 arcscan calls instead of ~5-8**, all of which are
now disk-cached (`cache.ts`) so a given token/deployer only ever costs that once.

**Correction to §5's "~21h reset":** that reading of `x-ratelimit-reset` doesn't hold
up empirically. Within roughly an hour of hitting 0/10, a live end-to-end run through
`/api/check` (§7) succeeded, and a follow-up header check showed **7/10 remaining**
with a very different (much larger) reset value than the first reading. The exact
reset semantics of this endpoint aren't fully understood — don't plan around a
21-hour lockout as a hard fact, but also don't assume the limit is generous: it's
real, it's tight, and it's better protected against by the cache than by waiting out
any particular number.

## 8. Bug found + fixed — `deployerLaunchVelocity` was structurally blind to lolpad-style launches

User asked, correctly suspicious: why did CATTY (created by RABBIT's same deployer,
~18h later) not count as a "prior launch" for RABBIT? Root-caused with two arcscan
calls, both worth their cost:

RABBIT's own top-level launch transaction (block 61279903) has
`to: 0xabE2dA9…` (a real address, lolpad's factory contract) and empty
`contractAddress` — **it is a plain contract *call*** (`methodId 0x054b880d`,
presumably `createToken`-shaped), not a direct `CREATE` from the creator's EOA.
Confirmed via the factory's own internal transactions
(`account/txlistinternal`) at that block:

```
type: create2   contractAddress: 0xbd2297…a325  (= RABBIT itself)
type: create2   contractAddress: 0x977fbb…437e  (= its bonding-curve pool)
```

Both are **internal** operations of the factory, invisible to `account/txlist` for
the *creator's* address no matter how far back it's paged — `getCreatedContracts`
was looking for the wrong shape of transaction entirely for this launch pattern.
Checked the creator's second factory call (block 61398600, ~17.7h later) the same
way — its `create2` output, `0xb57e7273…6e4e8`, is **exactly CATTY's address**,
confirming the same deployer really did launch both, and confirming the bug: no
amount of pagination would ever have found either one.

**Fix (`arc.ts`):** `getCreatedContracts` now also matches a creator's plain calls to
a small `KNOWN_LAUNCH_FACTORIES` registry (currently just lolpad's factory +
its create-method selector) as launch events, alongside the original direct-creation
check (still needed for bespoke, non-factory contracts like Knidos). A
factory-detected hit has no cheaply-resolvable `contractAddress` (that needs a
per-hit internal-tx lookup we don't want to spend on every candidate), so
`CreatedContract.contractAddress` is now optional, and `tokenSignals.ts` excludes
"this token's own launch" by **matching timestamp** instead of address (the mint
event's timestamp is exactly the launch tx's block timestamp either way).

**Verified live, both directions, after the fix:**
- CATTY: `deployerPriorLaunches7d = 1` (correctly counts RABBIT, which came first) →
  reason line "Deployer launched 1 other token(s) in the 7 days around this one",
  **score 53**.
- RABBIT: still `deployerPriorLaunches7d = 0` (correctly excludes CATTY, which came
  *after* RABBIT — not "prior") — **score unchanged at 36**.

**Known remaining limitation:** only lolpad's factory is registered. A different
launchpad using its own factory pattern (or a *bespoke* factory not in
`KNOWN_LAUNCH_FACTORIES`) would silently under-count the same way RABBIT/CATTY did
before this fix — there's no generic factory-detection here, just a growable
allowlist. Worth widening once a second real launchpad is checked by hand the same
way this one was.

## 9. MAJOR — Arc is two chains, and most of the real activity is on the one ArcVet doesn't read

Went looking for Warp's factory address (`LAUNCHPADS.md`) and found something bigger:
**everything this repo has verified so far — RABBIT, CATTY, ARCAT, the whole SPEC.md
formula — is real, but it's real on Arc *Testnet* (chain 5042002). A second, separate
chain, plainly called just "Arc" (chain **5042**), is already live, and it's where
Warp (243 tokens, $1.96M volume) and TollyLabs' tokens actually are** — a token
address grabbed straight from each platform's own site (Warp's `WARP`, Tolly's
`Argus`) is an **empty EOA with zero transactions on testnet** and a **real,
bytecode-bearing contract on chain 5042**.

### How this was found, in order (each step free — no arcscan budget spent)

1. Warp's homepage JS bundle (`circlewarp.fun`) references
   `arc-mainnet.cloud.blockscout.com` and its own RPC proxy,
   `https://warp-arc-production.up.railway.app/rpc`.
2. That proxy answers `eth_chainId → 0x13b2` (**5042**, decimal) and a real,
   advancing `eth_blockNumber` (20M+). `eth_getCode` on the "empty EOA" WARP address
   returns real `CurveToken` bytecode there (1e9 hardcoded supply, `CurveToken:`
   revert strings — an exact match for the `ArcFactory.sol` source Warp's own page
   displays).
3. Found the real, independent explorer for it: **`arc-scan.org`** (Cloudflare
   bot-check in front — needs a real browser, `curl` gets a JS challenge page).
   Its `/llms.txt` (a machine-readable doc file, apparently written specifically for
   agents) states outright:

   > *"The Arc network is two chains, and Arcscan is two deployments built from one
   > source tree. The production chain is Arc, chain ID 5042; the test chain is Arc
   > Testnet, chain ID 5042002. Everything under https://arc-scan.org is chain 5042
   > and nothing else… The other chain is served by a separate Arcscan deployment on
   > its own hostname."*

   `api.arc-scan.org/v1/chain` confirms it live: `"chain_id": 5042, "name": "Arc",
   "is_testnet": false, "mainnet_soon": false`. `erc20_native` is the same address
   pattern as testnet's USDC view (`0x3600…0000`, 6 decimals) — the two chains share
   that convention.
4. Confirmed genesis-to-now history: **live since at least 2026-08-29** (14 complete
   days of tx history shown on the homepage at the time of checking), ~100K
   tx/day, 506ms blocks, 1.37M+ total transactions — this is not a demo or a
   just-switched-on network. "Mainnet Summer 2026" / "Sept 16" messaging elsewhere
   (`pad.chaingpt.org`, community framing) is best read as the *public launch/
   announcement* date, not the chain's actual genesis.
5. Resolved Warp's real factory address the proper way, using `arc-scan.org`'s own
   API rather than guessing: `GET /v1/address/{WARP_token}/facts` → first-activity
   tx hash → `GET /v1/txs/{hash}` → `to` field. Full write-up in `LAUNCHPADS.md`.

### `arc-scan.org` / `api.arc-scan.org` — what it offers, for when Phase 2 needs it

Worth recording in detail; this is a materially better toolkit than testnet's arcscan
for everything ArcVet's read layer struggled with:

- **JSON-RPC**: `POST https://rpc.arc-scan.org` — no key, CORS-open, ≤50 calls/batch,
  ≤131072 bytes/body. Refuses `trace_*`/`debug_*` (cost policy) and signing methods
  (holds no keys) with a structured JSON-RPC error naming the reason — not silence.
- **REST API base**: `https://api.arc-scan.org` (`/v1/...`), CORS-open for
  GET/HEAD/OPTIONS. Relevant routes ArcVet doesn't have equivalents for today:
  `/v1/tokens/{addr}/holders` and Etherscan-shape `token.tokenholderlist` — **a real
  holder list**, not reconstructed from raw transfers (`holder_index: true` in
  `/v1/chain`'s capabilities). `/v1/address/{addr}/facts` — first/last activity,
  funding source. `/v1/txs/{hash}/trace` — per-transaction internal call frames
  (works, unlike an address-wide internal-tx scan, which this deployment explicitly
  refuses — its own traces index holds no blocks for that query shape).
- **Etherscan-shape**: `https://api.arc-scan.org/api?module=…&action=…` — the doc
  says explicitly *"moving existing Etherscan code: change the base URL, keep
  sending `apikey`… nothing else changes"* — this repo's `arcscan()` helper
  (`arc.ts`) could plausibly point here almost unchanged for a chain-5042 client.
  Notable differences from testnet's arcscan: `contract.getcontractcreation` is
  **refused** here (no otterscan namespace on this node) — creation info comes from
  the address/contract or address/facts+tx route instead, the way Warp's factory
  was actually found above.
- **Rate limit: a burst of 300 requests, refilling at 60/second**, keyed per calling
  IP. Compare to testnet's arcscan: **10 requests per ~hour-ish window** (DECISIONS.md
  §5). This alone would remove most of the caching/throttling machinery this repo
  had to build (`cache.ts`, backoff loops in `arc.ts`) if ArcVet read chain 5042
  instead of/in addition to testnet.
- **Requires a descriptive `User-Agent`** — the edge 403s several default HTTP-client
  UAs (e.g. bare `Python-urllib`) before the request even reaches the service.
- **No contract verification on this chain yet** ("our verification provider does
  not cover chain 5042 today") — `getabi`/`getsourcecode` return empty/NOTOK
  regardless of what the deploying team may have published elsewhere (e.g. Warp's
  own page shows source, but arcscan itself doesn't have it) — bytecode is always
  served regardless of verification status.
- Also present: a public **MCP server** at `POST https://api.arc-scan.org/mcp`
  (8 tools: chain status, block, tx, address, address-txs, token, token-holders,
  search) and an SSE block stream at `/v1/stream/head`.

### Open scope question for Phase 2 — not resolved here

ArcVet's entire chain config (`arc.ts`) points at testnet only. Given most of what's
actually active and interesting (Warp, TollyLabs, presumably arcpad.meme/minara.fun/
radardex.pro too — untested but the same "empty on testnet" pattern is likely) lives
on chain 5042, **the real decision for Phase 2 is whether ArcVet should read chain
5042 as a first-class target**, not just whether Warp's factory address is in a
list. Warp's factory is registered in `KNOWN_LAUNCH_FACTORIES` with `chainId: 5042`
and is explicitly inert (§8) until that decision is made and a chain-5042 read path
exists to use it.

**Decided the same day: yes — drop testnet, read chain 5042 directly.** See §10.

## 10. The pivot — `arc.ts` rewritten for chain 5042, testnet dropped

Not "add mainnet support alongside testnet" — the user's call was to point at chain
5042 **only**, since that's where everything real actually is (§9). `arc.ts` was
rewritten rather than parameterised over two chains; `arcTestnet` is gone.

**Chain config**: `ARC_CHAIN_ID = 5042`, RPC `https://rpc.arc-scan.org` (the
*official* public RPC named in `arc-scan.org/developers` — not Warp's own private
Railway proxy, which was only ever useful for de-risking this). API base
`https://api.arc-scan.org`. A descriptive `User-Agent` header is sent on every
`api.arc-scan.org` call — its docs say default HTTP-client UAs get 403'd by the edge
before reaching the service.

**Every primitive got simpler, not just re-pointed**, because `api.arc-scan.org`'s
REST surface (`/v1/...`) directly answers things the testnet-era code had to
reconstruct by hand:

- `getContractCreation` — `contract.getcontractcreation` is refused on this
  deployment ("no otterscan namespace"). Replaced with
  `/v1/address/{addr}/facts` → first-activity tx hash → `/v1/txs/{hash}` → that
  transaction's `from` and `block.timestamp`. For a factory-pattern launch this
  still resolves to the *human* creator (`tx.from`), not the factory (`tx.to`) —
  confirmed live on Warp's own token, whose "first" tx is the `createToken` call.
- `getEarlyTransfers` — replaced the chunked-RPC `eth_getLogs` scanner entirely.
  `/v1/tokens/{addr}/transfers` is cursor-paginated and returns `total` directly
  (no more summing pages to get a transfer count), and its `oldest_cursor` jumps
  straight to a token's earliest activity — so the creator-early-accumulation
  window is a handful of pages from genesis, not a scan of the token's entire
  history. Confirmed exact on WARP: the two earliest transfers are the mint
  (`0x0 → curve`, 1e9) and the creator's first buy — same story `eth_getLogs`
  chunking told on testnet's RABBIT, reached in one call instead of many.
- `getTopHolders` — `/v1/tokens/{addr}/holders` is **server-side ranked already**.
  Testnet had no equivalent (`tokenholderlist` answered "Unknown action" —
  DECISIONS.md §3 item 3) and ArcVet reconstructed balances from every transfer by
  hand; that whole code path is gone.
- `getCreatedContracts` — `/v1/address/{addr}/txs` tags each entry with
  `created_contract` (non-null for a plain top-level `CREATE`) and
  `method.is_creation`/`method.selector` directly, so the `KNOWN_LAUNCH_FACTORIES`
  match no longer has to guess a creation tx's shape from an absent field.
- `isVerified` — kept, but arc-scan.org's own docs say plainly that its
  verification provider doesn't cover chain 5042 yet, so expect `false` for every
  token today. Not hardcoded to `false` in case that changes.
- Rate limiting/backoff shrank a lot: chain 5042's limit is a 300-request burst
  refilling at 60/s (§9) vs. testnet's ~10-per-~21h. The disk cache (`cache.ts`)
  stayed — still useful for dev-loop speed and politeness — but the aggressive
  multi-attempt exponential backoff testnet needed is gone; a bare 429/`retry-after`
  retry is enough here.

**One real bug found running this against live data, fixed on the spot**: the
`topEoaHolder` search doesn't exclude `0x000…dead`, the conventional burn address.
Checking Argus (`LAUNCHPADS.md`), its #1-ranked holder *was* the burn address —
which would have read as "63% concentrated in one risky wallet" for what is
actually **deflationary supply removal**, the opposite of a risk signal.
`0x…dead` is technically a codeless EOA (`isContractAddress` correctly says no), so
nothing in the old logic caught it. Fixed in `tokenSignals.ts`: excluded alongside
the zero address. Re-ran Argus after the fix — a real wallet (3.00% share) surfaced
instead, score unchanged (69) since it landed in the same term bucket.

**Verified live, end to end, twice, immediately after the rewrite:**

| token | age | transfers | top EOA | deployer launches (7d) | owner | score | confidence |
|---|---|---|---|---|---|---|---|
| WARP (circlewarp.fun's own token) | 44.4d | 10,834 | 2.61% | 0 | no-admin | **75** | high |
| Argus (a TollyLabs token) | 232h | 6,164 | 3.00% (post burn-address fix) | 28 | **live-owner** | **69** | high |

Both plausible and legible: WARP (the platform's own flagship token, well
distributed, no admin) scores comfortably higher than a random TollyLabs launch
whose deployer address created 28 tokens in a week and still holds live owner
privileges — without either looking anything like RABBIT's front-run, concentrated
testnet case. `tsc` + `eslint` clean throughout.

**Left as-is, deliberately:** `scripts/fixture-rabbit.ts` (SPEC.md §8's testnet
worked example) still passes unmodified — it calls `scoreToken` directly with
hand-built `TokenSignals`, so it never touched the read layer and needed no changes.
`KNOWN_LAUNCH_FACTORIES` keeps lolpad's testnet entry (`chainId: 5042002`), inert
under the chain-scoped filter (§8) — a harmless historical record, not dead code
worth deleting.

## 11. Checked the formula against 3 real, currently-crashing chain-5042 tokens — an honest gap, not a clean win

The user's ask: find a real rug on chain 5042 and see if ArcVet would have caught
it. Picked three fresh, sharply-declining tokens off RadarDex's live leaderboard —
biggest, freshest drops, the closest thing to a real-time rug-pull signature
available: **BARC** (−56.42% in 24h, 2 days old), **sharc attac** (−55.48%, 1 day
old), **VORT** (−55.80%, 2 days old). Addresses pulled from the page's own DOM
(regex over `outerHTML`), not by accepting RadarDex's terms/risk-disclosure modal —
that would need the user's permission first and wasn't necessary to read public
data already rendered on the page.

**Result, reported exactly as it came out, not adjusted to fit a narrative:**

| token | 24h | age | score | confidence |
|---|---|---|---|---|
| sharc attac | −55.48% | 38.8h | **88** | medium |
| VORT | −55.80% | 67.3h | **75** | medium |
| BARC | −56.42% | 64.1h | **96*** | medium |

**All three scored medium-to-high — ArcVet's current signals did not flag any of
them.** (*BARC's holder-concentration term dropped out — see the bug below — so its
96 is out of 4 terms, not 5; treat it as less conclusive than the other two, which
scored high on the full formula.)

**This is not read as "the formula is broken."** A sharp price decline is not the
same claim as a rug pull, and nothing here proves malicious intent on any of these
three — a memecoin that pumped on launch hype and gave it back within a day or two
is an extremely common, non-malicious pattern in this category, not necessarily
evidence of extraction. What the result *does* show, honestly: **every signal
ArcVet currently measures — holder concentration, creator early-accumulation,
deployer velocity, ownership, verification — comes from ERC-20 balances and
contract state. None of them look at the DEX pool or price action at all.** A rug
mechanism that plays out through the pool (heavy sell pressure through the curve,
or a liquidity pull once one exists to pull) would be genuinely invisible to this
formula regardless of how it turned out for these three specific tokens. SPEC.md's
formula has carried "liquidity lock/pull: not wired up" as a known, named gap since
Phase 1 (`DECISIONS.md §3` item 7) — this is that gap actually mattering, not a new
one. Worth being equally honest in the other direction, given how easy it would be
to overclaim here: **we don't know these three actually were rugs.** We know
ArcVet's current signals didn't flag them, and we know why that class of outcome —
rug or not — would slip past a formula that never looks at price or liquidity.

**Bug found and fixed in the process, unrelated to the above but found because of
it**: `getTopHolders` crashed outright on BARC (`TypeError: Cannot read properties
of undefined (reading 'map')`) instead of failing cleanly. Root cause, confirmed
directly:

```
GET https://api.arc-scan.org/v1/tokens/{BARC}/holders
-> {"error":{"code":"INTERNAL","message":"Internal server error","detail":null}}
```

A real failure on arc-scan.org's side for this specific token, not our bug — but
our handling of it was wrong twice over. First, an unhandled crash instead of a
clean error. Second, and worse had it gone unnoticed: if `getTopHolders` had simply
returned `[]` on failure (the tempting quick fix), `findTopEoaHolder` would read
that as "no concentrated holder anywhere" — score.ts would confidently report
`holderConcentration = 1` (the *safest* possible value) for a token we in fact know
nothing about. That's the exact failure mode arc-scan.org's own `/llms.txt`
explicitly warns against: *"a value that cannot be known is reported as unknown and
never filled in with a plausible one."*

**Fix:** `getTopHolders` (`arc.ts`) now throws on an error-shaped response instead
of crashing on the assumption of a well-formed one. `TokenSignals` (`score.ts`)
gained a `holderDataAvailable: boolean` field; `findTopEoaHolder`
(`tokenSignals.ts`) catches the throw and reports `available: false` rather than an
empty list. `holderConcentration`'s applicability is now
`transferCount > 0 && holderDataAvailable` — an unavailable read drops the term
(renormalised away, same machinery as every other inapplicable term) instead of
silently scoring as safe. Reason string: *"Holder data unavailable — this term was
dropped, not assumed safe."*

**Second, smaller bug fixed in the same pass**: `push()`, the internal helper that
records each term's `reason` string, only appended the reason to `reasons[]` when
the term was `applicable`. `creatorEarlyAccumulation`'s "too early to assess"
message (written months earlier, Phase 1) had *always* been silently dropped for
that reason — nobody had hit a genuinely-too-new token in testing to notice.
Fixed: `push()` now always records the reason, applicable or not. An explainable
score that silently omits the explanation for exactly the terms it couldn't
compute was undermining the one thing this project has repeatedly leaned on
(RABBIT, the burn-address fix, the Warp/CATTY fix) — showing its work, including
when the work is "couldn't tell."

Re-ran `scripts/fixture-rabbit.ts` after both fixes: unchanged, score 27, as
expected — a pure `scoreToken` unit test with `holderDataAvailable: true` added
to its hand-built input. `tsc` + `eslint` clean.

## 12. Liquidity signal — hypothesis tested and falsified as a generic rule

Directly following §11's gap (no signal reads DEX liquidity at all), tested one
candidate generic approach before writing any scoring code: **since every
bonding-curve mint sends 100% of supply to a single contract, does the recipient
of a token's very first `Transfer(0x0 -> X, totalSupply)` generically identify
"the pool," regardless of which launchpad's contract template was used?** This
would be attractive because it needs zero new bytecode analysis — `getEarlyTransfers`
already fetches this data.

Checked the genesis transfer(s) for all 5 reference tokens (`scripts/liquidity-recon.ts`,
walking to `oldest_cursor` on `/v1/tokens/{addr}/transfers`):

| Token | Mint pattern | Hops to final resting address | Result |
|---|---|---|---|
| WARP | single hop | 1 | Recipient `0xff32834f...` — **exact byte-for-byte match** to Warp's own bytecode-embedded curve-address view (`0x7165485d`), independently confirmed in the prior recon pass. Clean confirmation. |
| VORT | 2-hop chain (`method: null`, plain transfers, not a router call) | 2 | Naive "immediate recipient" (`0xb742e4d2...`) is **not** the final resting address — supply moves on to `0x9abf283f...` one hop later. The one-hop version of the hypothesis silently picks the wrong address. |
| Argus (Tolly) | single hop | 1 | Recipient found (`0x0f1c7cb2...`), but Argus's contract is an EIP-1167 minimal-proxy clone (§10) — no independent confirmation this is a liquidity pool rather than a vesting/allocation contract. Unverified. |
| BARC | 6-hop chain, every hop tagged `method: multicall`, atomic — all in one block | 6+ | Mint routes through `0x0000ffff...` → `0xfe7be4eb...` → `0x6049c9a0...` → `0x8366a39c...` → back through `0xfe7be4eb...` → partially burned, partially settling at `0xf803dc46...`. |
| sharc_attac | Same shape as BARC, 6-hop atomic `multicall` chain | 6 | Shares **three of the same intermediate addresses** as BARC's chain (`0x0000ffff...`, `0x6049c9a0...`, `0x8366a39c...`) — clearly shared router/aggregator infrastructure behind both launches, not launchpad-specific curve contracts. Final resting address differs per token. |

**Verdict: falsified as a generic, hop-count-agnostic rule.** It only holds cleanly
for Warp's specific design (single deliberate recipient, independently confirmed).
VORT already breaks the *one-hop* version. BARC and sharc_attac go through a
shared multi-hop atomic router — same shape as, but a different platform than,
Warp's `ArcFactory`, and different again from lolpad's. This is the same lesson
`KNOWN_LAUNCH_FACTORIES` already forced (§8): there is no bytecode- or
mint-shape-based shortcut across launchpads, only per-platform registration.

**A genuine, narrow, checkable result did come out of this**, not thrown away:
Warp's own curve (`0xff32834f...`) currently holds **0.0000002 USDC** — essentially
nothing. Read naively this looks alarming, but Warp graduates a curve to
WarpDex/Uniswap V4 at $69K mcap and the curve balance is expected to drain to ~0
*on success* — so "curve balance ≈ 0" is ambiguous by itself: it means either
"rugged" or "graduated," and ArcVet cannot yet tell those apart (would need to
check whether a corresponding WarpDex pool now holds the liquidity instead).
VORT's true final-resting address (`0x9abf283f...`, found only after correcting
for the 2-hop chain) was not yet balance-checked before this was written up.

**Decision: paused, not shipped.** Did not write a `liquidityHealth` term against
an unreliable address-detection method. Reported findings to the user rather than
continuing to guess at more launchpads' router shapes unprompted.
