/**
 * End-to-end check: fetch real signals for a token address and score it.
 *   npx tsx scripts/check-token.ts <tokenAddress>
 * Defaults to RABBIT (DECISIONS.md §4 / SPEC.md §8's worked example) if no
 * address is given, so `npx tsx scripts/check-token.ts` alone reproduces it live.
 */
import type { Address } from "viem";
import { getTokenSignals } from "../src/lib/tokenSignals";
import { scoreToken } from "../src/lib/score";

const RABBIT = "0xbd2297cca409a8af3c864cae17292457ec72a325" as Address;
const target = (process.argv[2] as Address) ?? RABBIT;

console.log(`Fetching live signals for ${target} ...`);
const signals = await getTokenSignals(target);
console.log(JSON.stringify(signals, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

const result = scoreToken(signals);
console.log(`\nscore=${result.score} confidence=${result.confidence} formula=${result.formulaVersion}`);
for (const r of result.reasons) console.log(" ·", r);
