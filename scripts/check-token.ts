/**
 * End-to-end check: fetch real signals for a token address on Arc (chain 5042) and
 * score it.
 *   npx tsx scripts/check-token.ts <tokenAddress>
 * Defaults to WARP (circlewarp.fun's own token — LAUNCHPADS.md) if no address is
 * given, so `npx tsx scripts/check-token.ts` alone works out of the box.
 */
import type { Address } from "viem";
import { getTokenSignals } from "../src/lib/tokenSignals";
import { scoreToken } from "../src/lib/score";

const WARP = "0x384c60f98ecd4c26345499345c03d677e40f115e" as Address;
const target = (process.argv[2] as Address) ?? WARP;

console.log(`Fetching live signals for ${target} ...`);
const signals = await getTokenSignals(target);
console.log(JSON.stringify(signals, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

const result = scoreToken(signals);
console.log(`\nscore=${result.score} confidence=${result.confidence} formula=${result.formulaVersion}`);
for (const r of result.reasons) console.log(" ·", r);
