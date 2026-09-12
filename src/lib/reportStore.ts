/**
 * Storage for Phase 2 community reports. Deliberately **not** on-chain, and not
 * the same disk cache Phase 1 uses (`cache.ts` — expiring, safe to lose): this is
 * the actual data, so losing it loses real reports.
 *
 * Why off-chain at all, given ProofGraph's own evidence layer is a real contract:
 * chain 5042 is Arc's real production network — real gas, real permanence, real
 * cost if this schema turns out wrong. ProofGraph's registry went straight to a
 * contract because it deployed to *testnet* play-money. Phase 2 here starts
 * off-chain on purpose, the same way ProofGraph itself started at V1 before V2's
 * structured on-chain registry — once the report shape and a real anti-sybil
 * design are proven, migrating to a contract is the natural next step, not a
 * surprise pivot.
 *
 * Storage mechanism: Upstash Redis (the "Vercel KV" product — Vercel migrated KV
 * to an Upstash-backed Marketplace integration, `@vercel/kv` is deprecated in
 * favor of `@upstash/redis` directly against the same `KV_REST_API_URL`/
 * `KV_REST_API_TOKEN` env vars). Replaces an earlier single-JSON-file version
 * (fine for local dev, not durable across a serverless redeploy or shared across
 * instances) now that this is headed toward a real deploy.
 */
import { Redis } from "@upstash/redis";
import type { Address } from "viem";
import type { ReportCategory } from "./evidence";

const redis = Redis.fromEnv();

export type StoredReport = {
  id: string;
  subject: Address;
  reporter: Address;
  category: ReportCategory;
  description: string;
  evidenceUri?: string;
  timestamp: number; // when the reporter signed it
  signature: `0x${string}`;
  receivedAt: number; // when this server accepted it
};

const reportsKey = (subject: string) => `arcvet:reports:${subject.toLowerCase()}`;

// Scoped to a UTC calendar day: countReportsByReporterToday only ever reads
// today's key, so a fixed 48h expiry (comfortably past the next UTC rollover)
// is enough cleanup without needing exact midnight math.
const DAILY_COUNT_TTL_SECONDS = 60 * 60 * 48;
const dailyCountKey = (reporter: string) =>
  `arcvet:reports:count:${reporter.toLowerCase()}:${new Date().toISOString().slice(0, 10)}`;

export async function addReport(report: StoredReport): Promise<void> {
  await redis.rpush(reportsKey(report.subject), report);
  const countKey = dailyCountKey(report.reporter);
  await redis.incr(countKey);
  await redis.expire(countKey, DAILY_COUNT_TTL_SECONDS);
}

export async function getReportsFor(subject: Address): Promise<StoredReport[]> {
  const reports = await redis.lrange<StoredReport>(reportsKey(subject), 0, -1);
  return reports.sort((a, b) => b.receivedAt - a.receivedAt);
}

export async function countReportsByReporterToday(reporter: Address): Promise<number> {
  const count = await redis.get<number>(dailyCountKey(reporter));
  return count ?? 0;
}

export const MAX_REPORTS_PER_REPORTER_PER_DAY = 5;
