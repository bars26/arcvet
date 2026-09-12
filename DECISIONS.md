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
