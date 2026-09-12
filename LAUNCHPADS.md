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
bonding curve. **Confirmed on chain 5042** (`eth_getCode` returned real bytecode —
an EIP-1167 minimal-proxy clone — for at least one token traded there).

**Correction (2026-09-12, prompted by a user-shared X post):** the original version
of this section listed 14 "Tolly tokens" (Argus, ACAT, Tolly, Barc, WARP, "sharc
attac", ...) with addresses "grabbed via the trade-chart links" on
tollylabs.com/tokens. **That was a methodology error, not just an unverified
guess** — it's now directly disprovable: WARP is independently confirmed launched
by circlewarp's own factory (this file's Warp section), and BARC is independently
confirmed launched via Uniswap's own Liquidity Launcher, attributed by a separate
source to a platform called "TradePools" (`DECISIONS.md §14`, `§18` below) — neither
went anywhere near Tolly at launch. **Tolly is a trading terminal/aggregator that
lists tokens from multiple launchpads, same as RadarDex** — appearing on its
trade-chart page is not evidence a token launched there. Argus specifically: its
own launch tx (`0x0a1bf781...`) calls `0x0f1c7cb26d6cd36bd4189e41947658b39437587a`,
a *different* router from either Warp's or BARC's — consistent with a third,
distinct launcher (a user-shared X post attributes Argus to **`@Arguspad`**
specifically, not Tolly — plausible given the name, not independently re-verified
beyond confirming it's neither Warp's nor BARC's launch path). Kept the platform
entry since Tolly itself is real and live; the specific token attributions above
were wrong and are retracted.

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

## Broader ecosystem map — from a public X post, unverified (2026-09-12)

The user shared a public X (Twitter) post listing Arc mainnet ecosystem projects
ahead of the Sept 16 public mainnet framing (see `DECISIONS.md §9` — chain 5042
itself has actually been live and active since late August; "mainnet" here is the
public-launch/marketing date, not when the chain started). **Not independently
verified** — handles and one-line descriptions from a third party, not checked
on-chain the way everything else in this file was. Kept as a lead list, not a
source of truth.

**Launchpads (the post counts ~9 live pre-mainnet; overlaps with what's above are
noted).** Two names stand out as candidates for identifying the shared 6-hop
atomic-`multicall` router pattern behind BARC and sharc_attac (`DECISIONS.md
§12` — both tokens are on Tolly per the confirmed recon above, but Tolly's
mechanism there was never resolved beyond "EIP-1167 clone," so a **direct
Uniswap V3/V4** launch model is a plausible match for that router shape):
- `@TollyLabs` — already confirmed live above (USDC-pool, permanently locked
  liquidity, per this post — a detail our own recon didn't establish).
- `@circlewarp` (Warp) — already fully confirmed above.
- `@arcpad_meme` — already confirmed above as live; this post adds **"direct
  Uniswap V3 launches, permanently locked LP"** — a mechanism detail worth
  checking against arcpad's other tokens beyond the one sample (`$ARCHIE`) we have.
- `@minarafun` — already confirmed above as live.
- `@ArcadeSwap` — **checked, ruled out.** Site is `arcade.trading` (found via the
  X profile's bio link). Its `/launchpad` page reads **"No tokens yet. Launch the
  first one →"** — zero tokens have ever launched through it. Can't be the
  platform behind BARC/sharc_attac, which are already days-old with real trading
  history.
- `@PUMP_archi` — **could not locate.** The handle 404s on X directly; several
  spelling variants (`archipump`, `pump_archive`, `pump.archi`) turned up nothing
  matching "direct Uniswap V4 launches on Arc" either as an X account or a
  website. Likely either mistyped in the source post, renamed, or not yet public.
  Not resolved — dropped as a lead rather than guessed at further.
- `@arcfunxyz` — bonding-curve, ~$25K graduation (vs. Warp's $69K). Not checked.
- `@actfunxyz`, `@onmidotfun`, `@Fliptfun` — not investigated.
- `@Arguspad` — **update, 2026-09-12**: originally noted here as "a different
  project from Argus, same name, unrelated" — that was backwards. A second
  user-shared X post attributes Argus (`0xece5ca8bf9220718e5727754026757512212cb3c`,
  ArcVet's own reference token) directly to Arguspad. See the Tolly section
  above for the correction and why the original Tolly attribution was wrong.

**Other categories mentioned (DEX/DeFi, payments, RWA, FX/perps, AI-agent
infrastructure, NFT/gaming, privacy)** — recorded for awareness, not launchpads
so not directly relevant to `KNOWN_LAUNCH_FACTORIES`, but worth remembering if
ArcVet's scope ever grows past "token launch trust" (e.g. `@catena_labs` and
`@nexorafi`'s agent-payment infrastructure directly overlaps with the x402
angle discussed alongside ArcVet before Phase 1 was chosen; full list not
reproduced here — ask if this needs expanding into its own section later).

**Resolved, and not a launchpad at all** (`DECISIONS.md §14`, verified against
a third-party article's on-chain claims):
`0x0000ffffbe8efe702c8703ae3477ff5de3d319c0` is **Uniswap's own official
Liquidity Launcher** on Arc, and
`0x8366a39cc670b4001a1121b8f6a443a643e40951` is **the Uniswap v4 PoolManager**
itself — chain-wide, shared infrastructure, not a per-launchpad router. BARC
and sharc_attac share those addresses because both were launched *directly*
through Uniswap's V4 tooling, not through a third-party-branded launchpad —
explaining why no launchpad's own factory (ArcadeSwap, arcfunxyz, or anything
else on this list) was ever going to match. `@arcfunxyz` is no longer worth
checking for this specific question.

## Second user-shared X post — ticker/CA list, unverified (2026-09-12)

Public mainnet is 4 days out per this post; the user doesn't have funds bridged
to Arc mainnet (missed the brief window it was open pre-launch — noted earlier
this session) and is watching RadarDex activity pick up ahead of it. This list
names specific tickers, contract addresses, and launchpad attributions — **not
independently verified** beyond the two spot-checks below, which already found
**two real corrections to this file** (see the Tolly section above): Argus and
ACAT were wrongly attributed to Tolly (methodology error — they're tradeable
on Tolly's terminal, which isn't the same as launched by Tolly). Given that,
treat every other attribution below the same way — a lead, not a fact, until
checked the same way.

| Ticker | CA | Claimed platform | Note |
|---|---|---|---|
| TOLLY | `0xbc43ce8dec648ea298c4275559b81d6261c90b67` | TollyLabs | terminal + launchpad, buyback-and-burn fees |
| ARGUS | `0xece5ca8bf9220718e5727754026757512212cb3c` | Arguspad | = ArcVet's own reference token; **re-attributed away from Tolly this session**, see above |
| WARP | `0x384c60f98ecd4c26345499345c03d677e40f115e` | circlewarp | already fully confirmed, this file |
| SHARCFUN | `0x99b37b7fccaa7a1030617b6195eb3045c523bb97` | SharcFun | **not the same token as "sharc attac"** (`0xbd88cf25a230f971adbf31efa30ed0d1bd3338be`, DECISIONS.md §11-17) — confusingly similar names, different addresses, don't conflate |
| ARCASH | `0x0bffa97f774824e9da843699aedd2835cb1b8022` | THEARCASH / longdotxyz's "IndexFi of arc" | fee-share to holders |
| LONG | `0x2164bb17a2d38c1b5170e987b2c0416df1efc752` | Longdotsupply | **= one of the addresses the user asked ArcVet to check earlier this session** (scored 61, low confidence, "deployer launched 12 other tokens" — that other-launches signal may literally be this same platform's own volume, not spam) |
| BRC | `0x11c87c506acf3ea0799f8717127fe55a184f8efd` | BRC_Exchange (by Noxa_Fi) | claimed "one of the oldest" |
| COOL ("usdc is cool") | `0xeb64987643db71c76b2a2be7e723decc995e5b37` | — | claimed reply from the real @USDC account |
| ARCAT | `0x07704b06981ea962b87296362a1281484d160000` | — | claimed "first ever deployed token" on Arc |
| ARCANINE | `0xf3715bf5c2de299f08b81180ffb739a8372a175f` | — | claimed "first ever *traded*" (distinct from first *deployed* = ARCAT) |
| ARCHITECTS | `0x8bcb94279fc2c984ec34e0c1f2192df8c69ea4f0` | — | named for the "Architects" community; explicitly "not affiliated" |
| STEVE | `0xa23632d6a32174ff4ee8e76aacf9f244e10cfd73` | — | named after Circle's own "Steve" AI agent; "not affiliated" |
| BEANCAT | `0x41c8a71f630c636294009fa4fb0cc4c3bbe674fe` | — | named for a claimed old (2012) @arc profile picture |
| ACAT | `0xf80457274fa646c7a8e0942d48be703864ef3d01` | o1_exchange | = ArcVet's own reference token; **re-attributed away from Tolly this session**, see above |
| BARC | `0x4753c45fb550fecaa143a47968659117e6ffc2ce` | "TradePools" | = ArcVet's own reference token from §11-17; this is the first attribution we've seen for who's actually behind BARC's launch (previously only knew it went through Uniswap's own Liquidity Launcher, DECISIONS.md §14 — "TradePools" would be the branded product built on top of that, consistent with BARC and Argus using *different* entry routers even though both eventually touch the same Uniswap V3/V4 infra) |
| ARCBAT | `0xbe0cad585ea2d13de2f4e36376be755c0afd8b97` | — | named for a Circle/USDC video reference |

**Also mentioned, not addresses**: `chart.zone` (aggregator, claims 10+ launchpad
coverage — a candidate alternative/supplement to RadarDex as a data source,
not checked), and a claim that "fomo app" will support Arc "on day 1."

**On the surrounding framing** (worth being direct about, matching this
project's own "advisory, not a guarantee" stance rather than echoing the
post's excitement): the post's own opening line doubts Robinhood-style hype
but still argues KOLs/copytraders/theses will move these regardless of
fundamentals — which is a real, honest dynamic to expect, but not a signal
ArcVet can or should try to price in. Nothing here changes ArcVet's job: read
what's on-chain, say what it does and doesn't show, and stay quiet about
where price goes.
