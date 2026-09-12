# Arc launchpads — reconnaissance notes

_Collected 2026-09-12, ahead of Phase 2. Browser-only recon (free) plus a couple of
arcscan/RPC spot-checks. Purpose: know what's actually live on Arc before deciding
what `KNOWN_LAUNCH_FACTORIES` (see `arc.ts` §8 in `DECISIONS.md`) needs to cover next._

> **Two different chains, confirmed while doing this recon — see `DECISIONS.md
> §9-10` for the full write-up.** Arc is *two* networks: **Arc Testnet, chain
> 5042002** (`rpc.testnet.arc.network` / `testnet.arcscan.app` — where ArcVet
> started, including SPEC.md's original RABBIT/CATTY/ARCAT reference cases) and
> **Arc — the real production chain, chain 5042** (`rpc.arc-scan.org` /
> `api.arc-scan.org`, live since at least late August with ~100K tx/day). Checking
> these platforms found **lolpad.fun is the outlier, on testnet** — Warp and
> TollyLabs are both confirmed live on chain **5042**, and arcpad.meme/minara.fun/
> radardex.pro are unconfirmed but likely the same given they're not on testnet
> either. **Decided the same day: ArcVet now reads chain 5042 exclusively — testnet
> support was dropped, not kept alongside it.** `arc.ts` was rewritten for chain
> 5042 (`DECISIONS.md §10`); lolpad's factory stays registered as an inert
> historical record, not a live target.

## Live, real tokens, worth building against

### lolpad.fun — testnet only; ArcVet no longer reads this chain
Bonding-curve, USDC/stock-paired ("pair your meme with GOOGL/NVDA/SPCX"), graduates
to its own DEX (**LolSwap**) at a fixed market cap. Factory `0xabE2dA9AB9F94F2Cf3B74B463E115E275e5007D5`,
create selector `0x054b880d`, registered in `KNOWN_LAUNCH_FACTORIES`
(`DECISIONS.md §8`) with `chainId: 5042002` — kept as a historical record (it's how
the whole formula was validated: RABBIT/CATTY/ARCAT, SPEC.md's original reference
cases) but inert now that the read layer targets chain 5042 only (`DECISIONS.md
§10`).

### circlewarp.fun ("Warp") — fully wired, the reason chain 5042 was found

**Factory confirmed and live: `0x0dCad158e98bC24455f9e94F46709d8a5F6D1255`, create
selector `0xefbe8fd1`, on chain 5042 — now ArcVet's only chain (`DECISIONS.md
§10`).** Registered in `arc.ts`'s `KNOWN_LAUNCH_FACTORIES` with `chainId: 5042` and
**active** — `getCreatedContracts` genuinely counts a creator's Warp launches today
(confirmed live: WARP's own creator shows 7 launches in the surrounding 7 days).

**243 tokens launched, $1.96M volume** at the time this was checked. Directly
relevant to ArcVet because:
- **Publishes its factory source on the page itself** (`ArcFactory.sol`, MIT
  licensed, shown inline at circlewarp.fun). `createToken(name, symbol, metadataURI,
  minTokensOut)` deploys a `CurveToken` + its `BondingCurve` in one call and emits:
  ```solidity
  event TokenCreated(address indexed token, address indexed curve,
                      address indexed creator, string name, string symbol,
                      string metadataURI);
  ```
  **`creator` is indexed** — a deployer's entire Warp launch history is a single
  `getLogs` call filtered by that topic, no txlist heuristics, no internal-tx
  lookups needed. Strictly better than the lolpad approach, once a chain-5042 read
  path exists to use it from.
- Also exposes `allTokens(uint256)` / `tokenCount()` / `curveOf(token)` directly on
  the factory — a way to enumerate *every* Warp launch, not just one deployer's.
- **CCTP-native cross-chain buys**: "the Buy button speaks CCTP" — burns USDC at the
  source chain (Ethereum/Base/Arbitrum), mints on Arc, swaps, one signature. Per the
  page, the Arc side is deployed; source-chain contracts are "not live yet."
- Graduates at $69K market cap to WarpDex or Uniswap V4, LP burned ("no admin keys").

**How the factory address was actually found** (the token link grabbed straight from
`circlewarp.fun/terminal`, `0x384c60f98ecd4c26345499345c03d677e40f115e`, turned out to
be an empty EOA on *testnet* — the platform simply isn't there):
1. Found Warp's own JS bundle references `arc-mainnet.cloud.blockscout.com` and a
   private RPC proxy, `https://warp-arc-production.up.railway.app/rpc`.
2. That RPC answered `eth_chainId → 0x13b2` = **5042**, `eth_blockNumber` in the
   20M+ range — a real, live, different chain. `eth_getCode` on the same "empty EOA"
   address returned real `CurveToken` bytecode (1e9 supply hardcoded, `CurveToken:`
   revert strings) on *this* chain.
3. Found the real explorer for it — **`arc-scan.org`** (Cloudflare-fronted; needs a
   browser, not `curl`, to pass the bot check) — whose own `/llms.txt` states
   outright: *"The Arc network is two chains… The production chain is Arc, chain ID
   5042; the test chain is Arc Testnet, chain ID 5042002."* See `DECISIONS.md §9`
   for the full write-up of what that site's API offers.
4. Used `arc-scan.org`'s proper API (`api.arc-scan.org/v1/address/{addr}/facts`) to
   get the WARP token's first transaction hash, then `/v1/txs/{hash}` to read that
   transaction's `to` (the factory) and `input` (ABI-decodes to `("WARP","WARP",
   "ipfs://…")`, matching `createToken`'s signature exactly).

### tollylabs.com/tokens ("Tolly") — live, revenue-share angle, chain 5042
"Launch a token on Arc, earn from every trade" — creators get a fee cut, not just a
bonding curve. At least 14 real tokens live (Argus, ACAT, Tolly, Barc, "usdc is
cool", WARP, O1NK, Cocoa Channel, Argos Bot, Architects, Potato, ARCASH, "sharc
attac", Duke — addresses grabbed via the trade-chart links, e.g. Argus =
`0xece5ca8bf9220718e5727754026757512212cb3c`). **Confirmed on chain 5042** (`eth_getCode`
returned real bytecode — an EIP-1167 minimal-proxy clone — via that chain's RPC;
the same address is an empty EOA on testnet). Factory/implementation address not
yet resolved.

### arcpad.meme — live, small
One visible token so far: "Archie Dolater" / `$ARCHIE`,
`0x59D67acb2E387e86d6755ceb369d1D700F5CDF95`, tagged "PAYS HOLDERS" (another
revenue-share model, distinct branding from Tolly's). Worth re-checking once it has
more launches — too thin a sample to learn anything from yet.

### minara.fun — live
"Discover, launch, and trade tokens with USDC-native liquidity." At least 5 tokens
ranked on its own leaderboard (didn't grab addresses — the token cards aren't plain
`<a href>` links, need a click-through to resolve them).

## Aggregator — probably the single best future data source

### radardex.pro — DexScreener-style aggregator across the whole ecosystem
Banner reads **"TRACK, LAUNCH AND TRADE TOKENS ON ARC MAINNET"** — worth treating as
a real, current claim rather than marketing-only copy: the user flagged that a
bridge into Arc briefly opened before mainnet and whoever got funds in trades here
now, ahead of the pack. **10,810 tokens tracked, $2.29M 24h volume, $4.43M
liquidity, 19.8K 24h txns** — a genuinely large, mature-looking index. Lists tokens
from *every* other platform checked here (WARP, TOLLY, ARCAT, "usdc is cool", BARC,
etc. all appear on its trending/leaderboard), plus its own "RadarLaunchpad" feature.
Also shows per-token trader/holder counts, liquidity %, and age directly — data
ArcVet currently has to reconstruct by hand from raw logs. **Priority to explore
before Phase 2**: does it have its own API? If so, it could replace a meaningful
slice of ArcVet's own arcscan-heavy discovery work (finding real launch addresses
to test, cross-checking holder/liquidity numbers) essentially for free.

## Not live yet — nothing to test against

- **pad.chaingpt.org/arc** — ChainGPT Pad's Arc page is a *pre-launch* landing page
  ("APPLY TO LAUNCH", "WATCH LIVE AND UPCOMING POOLS"). A curated, KYC'd, tiered-IDO
  model (stakeable `$CGPT` for allocation tiers) — structurally different from the
  permissionless bonding-curve factories above; each sale is likely its own
  contract, not a shared clone factory. Explicitly "not affiliated with Circle."
  Nothing to check on-chain yet.
- **arclaunch.fun** — "COMING SOON", X/Telegram links only, no product live.

## User-provided list, not yet independently checked

The user mentioned there are more launchpads beyond this list; these seven were
called sufficient for now. Revisit and extend this file when Phase 2 needs a wider
`KNOWN_LAUNCH_FACTORIES` set or more real test addresses.
