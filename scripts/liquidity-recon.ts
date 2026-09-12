/**
 * Day-1-style recon for a liquidity signal: for each token, find the mint
 * recipient (the address that received the entire initial supply — the
 * pool/curve, generically, regardless of which launchpad's contract template
 * was used) and check its current native + ERC-20 USDC balance.
 */
import { publicClient } from "../src/lib/arc";

const ARC_USDC_ERC20 = "0x3600000000000000000000000000000000000000" as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const BALANCE_OF_SELECTOR = "0x70a08231";

const TOKENS: Record<string, `0x${string}`> = {
  WARP: "0x384c60f98ecd4c26345499345c03d677e40f115e",
  Argus: "0xece5ca8bf9220718e5727754026757512212cb3c",
  BARC: "0x4753c45fb550fecaa143a47968659117e6ffc2ce",
  sharc_attac: "0xbd88cf25a230f971adbf31efa30ed0d1bd3338be",
  VORT: "0x1d46179686ba8a473477317629674c566c66249b",
};

async function getMintRecipient(tokenAddress: string): Promise<string | null> {
  // page from genesis (cursor unknown ahead of time) via the raw API directly,
  // walking forward until we see the mint (from == 0x0)
  const UA = { "User-Agent": "arcvet-dev/0.1 (research)" };
  const first = await fetch(`https://api.arc-scan.org/v1/tokens/${tokenAddress}/transfers?limit=1`, { headers: UA }).then((r) => r.json());
  const oldestCursor = first.oldest_cursor;
  if (!oldestCursor) return null;
  const page = await fetch(`https://api.arc-scan.org/v1/tokens/${tokenAddress}/transfers?limit=5&cursor=${oldestCursor}`, { headers: UA }).then((r) => r.json());
  const mint = (page.items ?? []).find((i: { from: { address: string } }) => i.from.address === ZERO);
  return mint?.to?.address ?? null;
}

async function balanceOf(token: `0x${string}`, holder: string): Promise<bigint> {
  const data = (BALANCE_OF_SELECTOR + holder.slice(2).padStart(64, "0")) as `0x${string}`;
  const { data: result } = await publicClient.call({ to: token, data });
  return result ? BigInt(result) : 0n;
}

for (const [name, addr] of Object.entries(TOKENS)) {
  const pool = await getMintRecipient(addr);
  if (!pool) {
    console.log(name, "-> mint recipient not found");
    continue;
  }
  const [nativeUsdc, erc20Usdc] = await Promise.all([
    publicClient.getBalance({ address: pool as `0x${string}` }),
    balanceOf(ARC_USDC_ERC20, pool),
  ]);
  console.log(
    name.padEnd(12),
    "pool/curve =",
    pool,
    " native USDC =",
    (Number(nativeUsdc) / 1e18).toFixed(4),
    " erc20 USDC =",
    (Number(erc20Usdc) / 1e6).toFixed(4),
  );
}
