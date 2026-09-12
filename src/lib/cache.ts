/**
 * Small disk-backed cache so repeated checks — dev testing, or multiple visitors
 * hitting the same token — don't re-spend arcscan's tight anonymous rate limit
 * (DECISIONS.md §5: 10 requests per ~21h). One JSON file per namespace under
 * `.cache/` (gitignored).
 *
 * Caveat, same one ProofGraph's x402 free-tier bucket carries: this is a local
 * filesystem cache. Fine for local dev and a single long-running instance; a
 * serverless multi-instance deployment (Vercel) won't share it across instances
 * or survive a redeploy. Good enough for Phase 1 / testnet — a shared store
 * (KV/DB) is the real fix once ArcVet takes real traffic.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE_DIR = join(process.cwd(), ".cache");
const BIGINT_TAG = "__bigint__";

type Entry<T> = { value: T; expiresAt: number };

function filePath(namespace: string): string {
  return join(CACHE_DIR, `${namespace}.json`);
}

// JSON has no bigint — TokenSignals/TransferEvent carry real ones (amounts, supply),
// so round-trip them through disk tagged rather than losing precision to Number().
function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? { [BIGINT_TAG]: value.toString() } : value;
}
function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && BIGINT_TAG in value) {
    return BigInt((value as Record<string, string>)[BIGINT_TAG]);
  }
  return value;
}

function readNamespace<T>(namespace: string): Record<string, Entry<T>> {
  try {
    return JSON.parse(readFileSync(filePath(namespace), "utf8"), reviver) as Record<string, Entry<T>>;
  } catch {
    return {};
  }
}

function writeNamespace<T>(namespace: string, data: Record<string, Entry<T>>): void {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(filePath(namespace), JSON.stringify(data, replacer), "utf8");
  } catch {
    // best-effort — a read-only filesystem (some serverless environments) just
    // means no caching happens, not a hard failure
  }
}

export function cacheGet<T>(namespace: string, key: string): T | undefined {
  const entry = readNamespace<T>(namespace)[key.toLowerCase()];
  if (!entry || Date.now() > entry.expiresAt) return undefined;
  return entry.value;
}

export function cacheSet<T>(namespace: string, key: string, value: T, ttlMs: number): void {
  const data = readNamespace<T>(namespace);
  data[key.toLowerCase()] = { value, expiresAt: Date.now() + ttlMs };
  writeNamespace(namespace, data);
}

export const TTL = {
  /** facts that don't change once true (a contract's creator, its creation block) */
  FOREVER: 30 * 24 * 60 * 60 * 1000,
  HOUR: 60 * 60 * 1000,
  TEN_MIN: 10 * 60 * 1000,
} as const;
