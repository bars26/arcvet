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
 * Storage mechanism: one JSON file, same pattern as `cache.ts`. This is fine for
 * local dev and a single long-running instance; it is **not** durable against a
 * serverless redeploy or shared across instances — a real database is required
 * before this takes real traffic. Flagged here exactly like `cache.ts`'s and
 * ProofGraph's x402 free-tier bucket's own caveats — not a new kind of shortcut.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";
import type { ReportCategory } from "./evidence";

const DATA_DIR = join(process.cwd(), ".data");
const REPORTS_FILE = join(DATA_DIR, "reports.json");

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

function readAll(): StoredReport[] {
  try {
    return JSON.parse(readFileSync(REPORTS_FILE, "utf8")) as StoredReport[];
  } catch {
    return [];
  }
}

function writeAll(reports: StoredReport[]): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2), "utf8");
  } catch {
    // best-effort — a read-only filesystem means reports silently don't persist,
    // not a hard failure (same tradeoff as cache.ts)
  }
}

export function addReport(report: StoredReport): void {
  const all = readAll();
  all.push(report);
  writeAll(all);
}

export function getReportsFor(subject: Address): StoredReport[] {
  const s = subject.toLowerCase();
  return readAll()
    .filter((r) => r.subject.toLowerCase() === s)
    .sort((a, b) => b.receivedAt - a.receivedAt);
}

export function countReportsByReporterToday(reporter: Address): number {
  const r = reporter.toLowerCase();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const cutoff = startOfDay.getTime();
  return readAll().filter((x) => x.reporter.toLowerCase() === r && x.receivedAt >= cutoff).length;
}

export const MAX_REPORTS_PER_REPORTER_PER_DAY = 5;
