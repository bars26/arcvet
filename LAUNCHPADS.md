# Arc launchpads — reconnaissance notes

_Collected 2026-09-12, ahead of Phase 2. Browser-only recon (free) plus a couple of
arcscan/RPC spot-checks. Purpose: know what's actually live on Arc before deciding
what `KNOWN_LAUNCH_FACTORIES` (see `arc.ts` §8 in `DECISIONS.md`) needs to cover next._

## Live, real tokens, worth building against

### lolpad.fun — already integrated
Bonding-curve, USDC/stock-paired ("pair your meme with GOOGL/NVDA/SPCX"), graduates
to its own DEX (**LolSwap**) at a fixed market cap. Factory `0xabE2dA9AB9F94F2Cf3B74B463E115E275e5007D5`,
create selector `0x054b880d`, both registered in `KNOWN_LAUNCH_FACTORIES`
(`DECISIONS.md §8`). This is the platform RABBIT/CATTY/ARCAT (our SPEC.md reference
cases) come from.

### circlewarp.fun ("Warp") — HIGH PRIORITY, not yet integrated
**243 tokens launched, $1.96M volume** — the most active launchpad checked. Directly
relevant to ArcVet because:
- **Publishes its factory source on the page itself** (`ArcFactory.sol`, MIT
  licensed, shown inline at circlewarp.fun). `createToken(name, symbol, metadataURI,
  minTokensOut)` deploys a `CurveToken` + its `BondingCurve` in one call and emits:
  ```solidity
  event TokenCreated(address indexed token, address indexed curve,
                      address indexed creator, string name, string symbol,
                      string metadataURI);
  ```
  **`creator` is indexed** — if we get the deployed factory's address, a deployer's
  entire Warp launch history becomes a single `getLogs` call filtered by that topic,
  no txlist heuristics, no internal-tx lookups needed. Strictly better than the
  lolpad approach once wired up.
- Also exposes `allTokens(uint256)` / `tokenCount()` / `curveOf(token)` directly on
  the factory — a way to enumerate *every* Warp launch, not just one deployer's.
- **CCTP-native cross-chain buys**: "the Buy button speaks CCTP" — burns USDC at the
  source chain (Ethereum/Base/Arbitrum), mints on Arc, swaps, one signature. Per the
  page, the Arc side is deployed; source-chain contracts are "not live yet."
- Graduates at $69K market cap to WarpDex or Uniswap V4, LP burned ("no admin keys").
- **Not yet done:** the actual deployed factory *address* — the token link grabbed
  from `circlewarp.fun/terminal` (`0x384c60f98ecd4c26345499345c03d677e40f115e`)
  turned out to be an **empty EOA** on arcscan, not a real token contract, so the
  site's `/trade/:id` routing isn't a literal contract address (or that particular
  link was stale). Needs a proper look — e.g. a "view contract" link in Warp's own
  UI, or resolving one of RadarDex's WARP-platform listings — before this factory
  can be added to the registry.

### tollylabs.com/tokens ("Tolly") — live, revenue-share angle
"Launch a token on Arc, earn from every trade" — creators get a fee cut, not just a
bonding curve. At least 14 real tokens live (Argus, ACAT, Tolly, Barc, "usdc is
cool", WARP, O1NK, Cocoa Channel, Argos Bot, Architects, Potato, ARCASH, "sharc
attac", Duke — addresses grabbed via the trade-chart links, e.g. Argus =
`0xece5ca8bf9220718e5727754026757512212cb3c`). Factory pattern not yet checked.

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
