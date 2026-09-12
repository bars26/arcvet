/**
 * Arc Testnet chain config + low-level read primitives for ArcVet.
 *
 * Every primitive here was chosen because it was actually confirmed working against
 * live Arc Testnet data in DECISIONS.md §3-4-6 — nothing here is assumed:
 * - Transfer-log history is read from the **raw RPC**, chunked (see
 *   `getAllTransfers`) — not from arcscan. ProofGraph's "the public RPC prunes
 *   history" finding turned out not to hold here for chunked queries: the RPC caps
 *   response *size* and request *rate* per call, not log retention (DECISIONS.md §6).
 * - `getcontractcreation` (who deployed it + when) and the deployer's created-
 *   contracts list have no RPC equivalent — those still go through arcscan.
 * - `tokenholderlist` / `tokeninfo` are unsupported ("Unknown action") on this
 *   Blockscout instance — holder balances are reconstructed from raw transfers.
 * - the anonymous arcscan API rate-limits hard: **10 requests per ~21h window**,
 *   confirmed via response headers (DECISIONS.md §5) — every arcscan call here is
 *   cached to disk (`./cache.ts`) before anything else, and throttled/retried on
 *   top of that, not fired freely.
 */
import { createPublicClient, defineChain, http, parseAbiItem, type Address } from "viem";
import { cacheGet, cacheSet, TTL } from "./cache";

export const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARCSCAN_API_URL = "https://testnet.arcscan.app/api";

export const arcTestnet = defineChain({
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_TESTNET_RPC] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
});

export const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

// --- arcscan API: generic fetch with rate-limit backoff -----------------------------

let lastCallAt = 0;
const MIN_GAP_MS = 600; // conservative gap given the observed public rate limit

async function throttle() {
  const wait = lastCallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

/** GET testnet.arcscan.app/api with throttling + backoff-retry on rate-limit. */
export async function arcscan<T = unknown>(params: Record<string, string>): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await throttle();
    const url = `${ARCSCAN_API_URL}?${new URLSearchParams(params).toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const json = (await res.json()) as { status: string; message: string; result: T };
    if (json.message?.startsWith("Too many requests")) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    return json.result;
  }
  throw new Error(`arcscan rate-limited after retries: ${JSON.stringify(params)}`);
}

// --- contract creation ---------------------------------------------------------------

export type ContractCreation = {
  contractAddress: Address;
  contractCreator: Address;
  blockNumber: number;
};

/**
 * Who deployed this contract, and when. Confirmed working — DECISIONS.md §3 item 1.
 * Cached forever: a contract's creator and creation block never change.
 */
export async function getContractCreation(address: Address): Promise<ContractCreation | null> {
  const cached = cacheGet<ContractCreation | null>("contract-creation", address);
  if (cached !== undefined) return cached;

  const result = await arcscan<Array<{ contractAddress: string; contractCreator: string; blockNumber: string }>>({
    module: "contract",
    action: "getcontractcreation",
    contractaddresses: address,
  });
  const row = result?.[0];
  const value = row?.contractCreator
    ? {
        contractAddress: row.contractAddress as Address,
        contractCreator: row.contractCreator as Address,
        blockNumber: Number(row.blockNumber),
      }
    : null;
  cacheSet("contract-creation", address, value, TTL.FOREVER);
  return value;
}

// --- transfer log history --------------------------------------------------------------

export type TransferEvent = {
  from: Address;
  to: Address;
  amount: bigint;
  blockNumber: number;
  timestamp: number; // unix seconds
};

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/**
 * Every Transfer event for a token, chronological — read from the **raw RPC**, not
 * arcscan. Contrary to ProofGraph's Day-1 finding (true for *unbounded* queries),
 * the RPC genuinely has the log data; it just caps response *size* per call and
 * rate-limits request *rate*, both fixed by chunking + backoff. This matters
 * because arcscan's anonymous API has a much harsher, hours-long lockout
 * (DECISIONS.md §5) — moving the heaviest, most frequent call off of it is what
 * makes ArcVet viable at all without an API key.
 *
 * Chunk size adapts down on a size-limit error and requests are spaced out with a
 * retry-with-backoff on a rate-limit error. Capped at `MAX_CHUNKS` (a bounded
 * number of RPC calls) — Phase 1 targets freshly-launched tokens with a short
 * history, not a full-lifetime archive of an old, heavily-traded one.
 */
const MAX_CHUNKS = 300; // empty chunks return fast; this is a latency cap, not a data cap
const INITIAL_CHUNK_BLOCKS = 2000n;
const MIN_CHUNK_BLOCKS = 50n;
const RPC_GAP_MS = 150;

export async function getAllTransfers(tokenAddress: Address, sinceBlock = 0n): Promise<TransferEvent[]> {
  // Not an arcscan budget concern (this reads the RPC), but a fresh-vs-old token can
  // take seconds-to-minutes to scan — a short cache saves a lot of dev-loop waiting
  // and repeat-visitor latency without going stale for long.
  const cacheKey = `${tokenAddress}:${sinceBlock}`;
  const cached = cacheGet<TransferEvent[]>("transfers", cacheKey);
  if (cached !== undefined) return cached;

  const fetched = await fetchAllTransfers(tokenAddress, sinceBlock);
  cacheSet("transfers", cacheKey, fetched, TTL.TEN_MIN);
  return fetched;
}

async function fetchAllTransfers(tokenAddress: Address, sinceBlock: bigint): Promise<TransferEvent[]> {
  const head = await publicClient.getBlockNumber();
  const out: TransferEvent[] = [];
  let from = sinceBlock;
  let chunk = INITIAL_CHUNK_BLOCKS;
  let chunksUsed = 0;

  while (from <= head && chunksUsed < MAX_CHUNKS) {
    const to = from + chunk - 1n > head ? head : from + chunk - 1n;
    try {
      const logs = await publicClient.getLogs({ address: tokenAddress, event: TRANSFER_EVENT, fromBlock: from, toBlock: to });
      const blocks = new Map<bigint, number>(); // cache block -> timestamp within this chunk
      for (const log of logs) {
        let ts = blocks.get(log.blockNumber!);
        if (ts === undefined) {
          const block = await publicClient.getBlock({ blockNumber: log.blockNumber! });
          ts = Number(block.timestamp);
          blocks.set(log.blockNumber!, ts);
        }
        out.push({
          from: log.args.from as Address,
          to: log.args.to as Address,
          amount: log.args.value as bigint,
          blockNumber: Number(log.blockNumber),
          timestamp: ts,
        });
      }
      from = to + 1n;
      chunksUsed++;
      await new Promise((r) => setTimeout(r, RPC_GAP_MS));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("size limit") && chunk > MIN_CHUNK_BLOCKS) {
        chunk = chunk / 2n > MIN_CHUNK_BLOCKS ? chunk / 2n : MIN_CHUNK_BLOCKS; // response too big — narrow the window
        continue;
      }
      if (msg.includes("rate limit")) {
        await new Promise((r) => setTimeout(r, 1000));
        continue; // same range, just wait out the RPC's own throttle
      }
      throw e;
    }
  }
  return out.sort((a, b) => a.blockNumber - b.blockNumber);
}

// --- deployer history -----------------------------------------------------------------

export type CreatedContract = { contractAddress?: Address; timestamp: number };

/**
 * Launchpad factories whose "create a token" call we recognise. Confirmed by hand
 * (DECISIONS.md §8): lolpad's factory deploys the token AND its bonding-curve pool
 * via two internal `create2`s per call — the top-level tx a creator sends is a plain
 * *call* to the factory (`to` = factory, `contractAddress` empty), never a direct
 * `CREATE` from the creator's own address. Add more factories here as they're found.
 */
const KNOWN_LAUNCH_FACTORIES: Array<{ name: string; address: Address; createMethodId: string; chainId: number }> = [
  { name: "lolpad", address: "0xabE2dA9AB9F94F2Cf3B74B463E115E275e5007D5", createMethodId: "0x054b880d", chainId: ARC_TESTNET_CHAIN_ID },
  // Warp (circlewarp.fun) — Arc's ArcFactory.sol, source published on the site.
  // createToken(string name, string symbol, string metadataURI, uint256 minTokensOut).
  // Confirmed by hand (LAUNCHPADS.md): the WARP token's own first transaction calls
  // this address with selector 0xefbe8fd1 and ABI-encoded ("WARP","WARP",<ipfs uri>).
  // On **chain 5042 — Arc mainnet**, not this file's testnet (5042002). Registered
  // for the record; inert until the read layer supports a second chain (see below).
  { name: "warp", address: "0x0dCad158e98bC24455f9e94F46709d8a5F6D1255", createMethodId: "0xefbe8fd1", chainId: 5042 },
];

/**
 * Contracts a deployer has created, chronological. No dedicated "list contracts by
 * creator" endpoint exists (DECISIONS.md §3 item 1) — paginates account/txlist and
 * keeps two kinds of hits: (a) a direct top-level creation (`contractAddress`
 * present — a bespoke contract deployed straight from the EOA, e.g. Knidos-style),
 * and (b) a call to a known launchpad factory's create method (DECISIONS.md §8 —
 * this is the *only* way to see a lolpad-style launch at all; the actual `CREATE2`
 * is an internal tx of the factory, invisible in this address's own txlist no
 * matter how far back it's paged). (b) entries have no resolvable `contractAddress`
 * without an extra per-hit lookup, so `contractAddress` is optional — callers that
 * need to exclude "this token's own launch" from the list should match by
 * timestamp, not address (see tokenSignals.ts).
 *
 * Capped at 3 pages (~300 most recent txs) — enough for the launch-velocity window
 * this feeds (7 days), not a full-lifetime archive for a very active address.
 */
export async function getCreatedContracts(deployer: Address): Promise<CreatedContract[]> {
  const cached = cacheGet<CreatedContract[]>("created-contracts", deployer);
  if (cached !== undefined) return cached;

  const out: CreatedContract[] = [];
  for (let page = 1; page <= 3; page++) {
    const rows = await arcscan<
      Array<{ to?: string; contractAddress?: string; input?: string; timeStamp: string }>
    >({
      module: "account",
      action: "txlist",
      address: deployer,
      sort: "desc",
      page: String(page),
      offset: "100",
    });
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      if (r.contractAddress) {
        out.push({ contractAddress: r.contractAddress as Address, timestamp: Number(r.timeStamp) });
        continue;
      }
      // Scoped to this file's chain (testnet, today): a factory registered for a
      // different chainId (e.g. Warp on mainnet 5042) must never match testnet
      // txlist rows just because addresses collide in theory — it's inert here by
      // design until a second chain is actually wired up (LAUNCHPADS.md).
      const factory = KNOWN_LAUNCH_FACTORIES.find(
        (f) =>
          f.chainId === ARC_TESTNET_CHAIN_ID &&
          r.to &&
          eqAddr(r.to, f.address) &&
          r.input?.startsWith(f.createMethodId),
      );
      if (factory) out.push({ timestamp: Number(r.timeStamp) });
    }
    if (rows.length < 100) break;
  }
  // moderate TTL: this list can only grow (a deployer might launch again), and it
  // feeds a 7-day rolling window, so an hour of staleness is an acceptable trade
  // against arcscan's tight anonymous rate limit on a fresh miss.
  cacheSet("created-contracts", deployer, out, TTL.HOUR);
  return out;
}

const eqAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// --- verification + generic selector probing -------------------------------------------

/**
 * Is the contract's source verified on arcscan? DECISIONS.md §3 item 4 — a real,
 * checkable, non-uniform signal (not "testnet = never verified"). Cached
 * asymmetrically: once verified, that never reverts, so cache it forever; an
 * unverified result gets a shorter TTL since someone could verify it later.
 */
export async function isVerified(address: Address): Promise<boolean> {
  const cached = cacheGet<boolean>("verified", address);
  if (cached !== undefined) return cached;

  const result = await arcscan<Array<{ SourceCode?: string }>>({
    module: "contract",
    action: "getsourcecode",
    address,
  });
  const verified = Boolean(result?.[0]?.SourceCode && result[0].SourceCode.length > 0);
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
 * Call the raw owner() selector — works without an ABI or verification
 * (DECISIONS.md §3 item 5, confirmed against a known no-admin contract and a known
 * real owner). A revert means "no such function" just as often as "reverted on
 * purpose", so it's read as "no discoverable admin surface", not "safe".
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
