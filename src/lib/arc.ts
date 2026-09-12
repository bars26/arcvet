/**
 * Arc chain config + low-level read primitives for ArcVet.
 *
 * Targets **chain 5042 — Arc, the real production chain** — not Arc Testnet
 * (chain 5042002). DECISIONS.md §9: the two are separate networks; almost every
 * launchpad worth building against (Warp, TollyLabs, ...) lives on this one, not
 * the testnet ArcVet started on. This file was rewritten for chain 5042 once that
 * was confirmed — see DECISIONS.md §10 for what changed and why.
 *
 * Data source is `arc-scan.org`'s own API (`api.arc-scan.org`), not a Blockscout
 * instance — a purpose-built, well-documented service (its own `/llms.txt` and
 * `/developers` page) that solves several problems the testnet-era code had to work
 * around by hand:
 * - a real holder-list endpoint (`/v1/tokens/{addr}/holders`, ranked, paginated) —
 *   no more reconstructing balances from raw transfers;
 * - a real per-token transfer count and cursor-paginated history
 *   (`/v1/tokens/{addr}/transfers`), including an `oldest_cursor` to jump straight
 *   to a token's earliest activity;
 * - `/v1/address/{addr}/txs` entries carry `created_contract` and
 *   `method.is_creation` directly — no guessing from an absent `to` field;
 * - a **300-request burst refilling at 60/s** rate limit (vs. testnet arcscan's
 *   ~10-per-~hour), so the aggressive caching/backoff testnet needed matters far
 *   less here — still cached (politeness, dev-loop speed), not defensively.
 * - `contract.getcontractcreation` (Etherscan-shape) is refused on this deployment
 *   ("no otterscan namespace") — creation info comes from `/v1/address/{addr}/facts`
 *   (first activity) + `/v1/txs/{hash}` instead, which is also how a factory-pattern
 *   launch's *human* creator is recovered (its `from`), same as Warp's own factory
 *   address was found (LAUNCHPADS.md).
 * - **no contract on chain 5042 is verified today** ("our verification provider does
 *   not cover chain 5042" — arc-scan.org's own words) — `isVerified` below still
 *   calls the real endpoint rather than hardcoding `false`, in case that changes,
 *   but expect it to answer `false` for everything right now.
 *
 * A descriptive User-Agent is required — arc-scan.org's edge 403s several default
 * HTTP-client user agents before a request reaches the service.
 */
import { createPublicClient, defineChain, http, parseAbiItem, type Address } from "viem";
import { cacheGet, cacheSet, TTL } from "./cache";

export const ARC_CHAIN_ID = 5042;
export const ARC_RPC_URL = "https://rpc.arc-scan.org";
export const ARC_API_URL = "https://api.arc-scan.org";
export const ARC_EXPLORER_URL = "https://arc-scan.org";
const USER_AGENT = "ArcVet/0.1 (+https://github.com/bars26/arcvet)";

export const arcMainnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: { default: { name: "Arcscan", url: ARC_EXPLORER_URL } },
});

export const publicClient = createPublicClient({ chain: arcMainnet, transport: http() });

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

// --- api.arc-scan.org — REST (/v1) + Etherscan-shape (/api) -------------------------

/** GET api.arc-scan.org/v1/... with the required User-Agent + a 429 retry. */
async function apiV1<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${ARC_API_URL}${path}${qs}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "2");
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000));
      continue;
    }
    return (await res.json()) as T;
  }
  throw new Error(`api.arc-scan.org rate-limited after retries: ${path}${qs}`);
}

// --- contract creation ---------------------------------------------------------------

export type ContractCreation = {
  contractAddress: Address;
  contractCreator: Address;
  blockNumber: number;
  timestamp: number; // unix seconds — also the mint time for a fresh token
};

/**
 * Who deployed this contract, and when — via the address's first-ever activity,
 * not `getcontractcreation` (refused on this deployment). For a factory-pattern
 * launch (Warp, or any future one) this correctly resolves to the *human* who
 * called the factory, not the factory itself: `tx.from`, not `tx.to`. Cached
 * forever — a creator and creation block never change.
 */
export async function getContractCreation(address: Address): Promise<ContractCreation | null> {
  const cached = cacheGet<ContractCreation | null>("contract-creation", address);
  if (cached !== undefined) return cached;

  const facts = await apiV1<{ available: boolean; first: { hash: string } | null }>(
    `/v1/address/${address}/facts`,
  );
  if (!facts.available || !facts.first) {
    cacheSet("contract-creation", address, null, TTL.HOUR);
    return null;
  }
  const tx = await apiV1<{
    from: { address: string };
    block: { height: number; timestamp: number };
  }>(`/v1/txs/${facts.first.hash}`);

  const value: ContractCreation = {
    contractAddress: address,
    contractCreator: tx.from.address as Address,
    blockNumber: tx.block.height,
    timestamp: tx.block.timestamp,
  };
  cacheSet("contract-creation", address, value, TTL.FOREVER);
  return value;
}

// --- token transfers -------------------------------------------------------------------

export type TokenTransfersPage = {
  transfers: Array<{ from: Address; to: Address; amount: bigint; timestamp: number; block: number }>;
  total: number;
  oldestCursor: string | null;
};

/** One page of a token's transfer history (newest-first unless `cursor` is given). */
async function getTokenTransfersPage(tokenAddress: Address, cursor?: string): Promise<{
  items: TokenTransfersPage["transfers"];
  next: string | null;
  total: number;
  oldestCursor: string | null;
}> {
  const raw = await apiV1<{
    items: Array<{ from: { address: string }; to: { address: string }; amount: { raw: string }; timestamp: number; block: number }>;
    page: { next: string | null; oldest_cursor: string | null };
    total: number;
  }>(`/v1/tokens/${tokenAddress}/transfers`, { limit: "100", ...(cursor ? { cursor } : {}) });

  return {
    items: raw.items.map((t) => ({
      from: t.from.address as Address,
      to: t.to.address as Address,
      amount: BigInt(t.amount.raw),
      timestamp: t.timestamp,
      block: t.block,
    })),
    next: raw.page.next,
    total: raw.total,
    oldestCursor: raw.page.oldest_cursor,
  };
}

/**
 * The token's total transfer count, and every transfer up to `untilTimestamp`
 * (inclusive), starting from its earliest activity via `oldest_cursor` — cheap even
 * for a heavily-traded token, since we stop as soon as we're past the window
 * instead of paging the whole history. `untilTimestamp` should be the creator
 * early-accumulation cutoff (mint + 24h); this is not a general "all transfers"
 * fetch. Not cached — cheap, and staleness matters less than freshness here.
 */
export async function getEarlyTransfers(
  tokenAddress: Address,
  untilTimestamp: number,
): Promise<{ transfers: TokenTransfersPage["transfers"]; totalTransferCount: number }> {
  const first = await getTokenTransfersPage(tokenAddress);
  if (!first.oldestCursor) return { transfers: first.items, totalTransferCount: first.total };

  const early: TokenTransfersPage["transfers"] = [];
  let cursor: string | null = first.oldestCursor;
  for (let page = 0; page < 20 && cursor; page++) {
    const p: Awaited<ReturnType<typeof getTokenTransfersPage>> = await getTokenTransfersPage(tokenAddress, cursor);
    for (const t of p.items) if (t.timestamp <= untilTimestamp) early.push(t);
    const pastWindow = p.items.some((t) => t.timestamp > untilTimestamp);
    if (pastWindow || !p.next) break;
    cursor = p.next;
  }
  return { transfers: early, totalTransferCount: first.total };
}

// --- holders -------------------------------------------------------------------------

export type RankedHolder = { address: Address; balance: bigint };

/** Top holders by balance, already ranked server-side — no reconstruction needed. */
export async function getTopHolders(tokenAddress: Address, limit = 10): Promise<RankedHolder[]> {
  const raw = await apiV1<{ items: Array<{ address: { address: string }; balance: { raw: string } }> }>(
    `/v1/tokens/${tokenAddress}/holders`,
    { limit: String(limit) },
  );
  return raw.items.map((h) => ({ address: h.address.address as Address, balance: BigInt(h.balance.raw) }));
}

// --- deployer history -----------------------------------------------------------------

export type CreatedContract = { contractAddress?: Address; timestamp: number };

/**
 * Launchpad factories whose "create a token" call is recognised, so a factory-
 * pattern launch (the actual `CREATE`/`CREATE2` is an internal op, invisible in the
 * deployer's own tx list) still counts as a launch. DECISIONS.md §8 (lolpad, found
 * on testnet) and LAUNCHPADS.md (Warp, this chain). Matching is scoped to
 * `ARC_CHAIN_ID` below — an entry for a different chain never fires here.
 */
const KNOWN_LAUNCH_FACTORIES: Array<{ name: string; address: Address; createMethodId: string; chainId: number }> = [
  { name: "lolpad", address: "0xabE2dA9AB9F94F2Cf3B74B463E115E275e5007D5", createMethodId: "0x054b880d", chainId: 5042002 },
  { name: "warp", address: "0x0dCad158e98bC24455f9e94F46709d8a5F6D1255", createMethodId: "0xefbe8fd1", chainId: ARC_CHAIN_ID },
];

const eqAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Contracts a deployer has created, chronological. `account/txlist`'s REST
 * equivalent here (`/v1/address/{addr}/txs`) tags each entry directly —
 * `created_contract` for a plain top-level `CREATE`, `method.is_creation` /
 * `method.selector` for a call worth checking against `KNOWN_LAUNCH_FACTORIES` —
 * no guessing from an absent field the way the testnet-era code had to.
 * Capped at 3 pages (~300 most recent txs): enough for the 7-day launch-velocity
 * window this feeds, not a full-lifetime archive for a very active address.
 */
export async function getCreatedContracts(deployer: Address): Promise<CreatedContract[]> {
  const cached = cacheGet<CreatedContract[]>("created-contracts", deployer);
  if (cached !== undefined) return cached;

  const out: CreatedContract[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 3; page++) {
    const raw = await apiV1<{
      items: Array<{
        to: { address: string } | null;
        created_contract: { address: string } | null;
        timestamp: number;
        method: { selector: string; is_creation: boolean };
      }>;
      page: { next: string | null };
    }>(`/v1/address/${deployer}/txs`, { limit: "100", ...(cursor ? { cursor } : {}) });

    for (const r of raw.items) {
      if (r.created_contract) {
        out.push({ contractAddress: r.created_contract.address as Address, timestamp: r.timestamp });
        continue;
      }
      const factory = KNOWN_LAUNCH_FACTORIES.find(
        (f) => f.chainId === ARC_CHAIN_ID && r.to && eqAddr(r.to.address, f.address) && r.method.selector === f.createMethodId,
      );
      if (factory) out.push({ timestamp: r.timestamp });
    }
    if (!raw.page.next) break;
    cursor = raw.page.next;
  }
  // moderate TTL: this list can only grow, and it feeds a 7-day rolling window —
  // an hour of staleness costs little even against this chain's generous limit.
  cacheSet("created-contracts", deployer, out, TTL.HOUR);
  return out;
}

// --- verification + generic selector probing -------------------------------------------

/**
 * Is the contract's source verified? Real signal on Arc Testnet (DECISIONS.md §3
 * item 4) but **arc-scan.org's own docs say no contract on chain 5042 is verified
 * today** ("our verification provider does not cover chain 5042") — expect `false`
 * for everything right now. Still calls the real endpoint rather than hardcoding
 * that, in case coverage arrives.
 */
export async function isVerified(address: Address): Promise<boolean> {
  const cached = cacheGet<boolean>("verified", address);
  if (cached !== undefined) return cached;

  const raw = await apiV1<{ verified: boolean }>(`/v1/address/${address}/contract`);
  const verified = Boolean(raw.verified);
  cacheSet("verified", address, verified, verified ? TTL.FOREVER : TTL.HOUR);
  return verified;
}

/** True if `address` has bytecode (a contract), false if it's a plain EOA. */
export async function isContractAddress(address: Address): Promise<boolean> {
  const code = await publicClient.getCode({ address });
  return Boolean(code && code !== "0x");
}

const OWNER_SELECTOR = "0x8da5cb5b"; // owner()
const TOTAL_SUPPLY_SELECTOR = "0x18160ddd"; // totalSupply()

/**
 * Call the raw owner() selector — works without an ABI or verification (useful
 * given nothing on this chain is verified yet). A revert means "no such function"
 * just as often as "reverted on purpose", so it's read as "no discoverable admin
 * surface", not "safe".
 */
export async function probeOwner(address: Address): Promise<"no-admin" | "renounced" | "live-owner"> {
  try {
    const { data } = await publicClient.call({ to: address, data: OWNER_SELECTOR });
    if (!data || data.length < 42) return "no-admin";
    const owner = `0x${data.slice(-40)}`.toLowerCase();
    return owner === ZERO_ADDRESS ? "renounced" : "live-owner";
  } catch {
    return "no-admin";
  }
}

/** Raw totalSupply() — works for any standard ERC-20 without needing its ABI. */
export async function getTotalSupply(address: Address): Promise<bigint> {
  const { data } = await publicClient.call({ to: address, data: TOTAL_SUPPLY_SELECTOR });
  return data ? BigInt(data) : 0n;
}

// re-exported for callers that only need the AST-level event shape (unused today,
// kept for a future Warp-specific TokenCreated-log-based launch-velocity path —
// see LAUNCHPADS.md's "strictly better once wired up" note).
export const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
