/**
 * Sanity-check fixture: reproduce the score for the real RABBIT case investigated
 * manually in DECISIONS.md §4. Run: npx tsx scripts/fixture-rabbit.ts
 */
import { scoreToken } from "../src/lib/score";

const totalSupply = 1_000_000_000n * 10n ** 18n;
const creatorEarlyAcquired = 71697547683923705722070844n + 62723908254773612285591991n + 55335755599764220453875626n;

const result = scoreToken({
  tokenAgeHours: 72, // ~3 days, well inside "medium" confidence
  transferCount: 25, // real count, DECISIONS.md §4
  totalSupply,
  topEoaHolder: { address: "0x8f9da437878de701094e5644de7296255aa52451", balance: (totalSupply * 6296n) / 10000n },
  holderDataAvailable: true,
  creator: "0x80b4320815273a04084cdca656e7b094dfc6895f",
  creatorEarlyAcquired,
  deployerPriorLaunches7d: 1, // same deployer also made CATTY
  verified: false,
  ownerProbe: "no-admin",
});

console.log(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log(`\nexpected ~26 per SPEC.md §8 — got ${result.score}`);
