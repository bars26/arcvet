/**
 * Turns raw Arc chain data into the `TokenSignals` shape `scoreToken` (src/lib/score.ts)
 * expects. All I/O lives here; score.ts stays pure. See SPEC.md §2 for the contract.
 */
import type { Address } from "viem";
import {
  getContractCreation,
  getAllTransfers,
  getCreatedContracts,
  isVerified,
  isContractAddress,
  probeOwner,
  getTotalSupply,
  publicClient,
  type TransferEvent,
} from "./arc";
import type { TokenSignals } from "./score";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";
const EARLY_WINDOW_SECONDS = 24 * 60 * 60;
const DEPLOYER_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
const TOP_HOLDER_CANDIDATES = 10; // how many top balances to EOA-check before giving up

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Reconstruct current balances from the full transfer history. */
function reconstructBalances(transfers: TransferEvent[]): Map<string, bigint> {
  const bal = new Map<string, bigint>();
  const bump = (addr: string, delta: bigint) => bal.set(addr, (bal.get(addr) ?? 0n) + delta);
  for (const t of transfers) {
    bump(t.from.toLowerCase(), -t.amount);
    bump(t.to.toLowerCase(), t.amount);
  }
  bal.delete(ZERO_ADDRESS);
  return bal;
}

async function findTopEoaHolder(
  balances: Map<string, bigint>,
  exclude: Address,
): Promise<{ address: `0x${string}`; balance: bigint } | null> {
  const ranked = [...balances.entries()]
    .filter(([addr, amt]) => amt > 0n && !eq(addr, exclude))
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .slice(0, TOP_HOLDER_CANDIDATES);

  for (const [address, balance] of ranked) {
    if (!(await isContractAddress(address as Address))) {
      return { address: address as `0x${string}`, balance };
    }
  }
  return null;
}

/** Fetch + assemble everything `scoreToken` needs for one token address. */
export async function getTokenSignals(tokenAddress: Address): Promise<TokenSignals> {
  const creation = await getContractCreation(tokenAddress);
  if (!creation) {
    throw new Error(
      `could not find a contract-creation record for ${tokenAddress} — not indexed yet, or not a contract`,
    );
  }

  const [transfers, verified, ownerProbe, totalSupply, creationBlock] = await Promise.all([
    getAllTransfers(tokenAddress, BigInt(creation.blockNumber)),
    isVerified(tokenAddress),
    probeOwner(tokenAddress),
    getTotalSupply(tokenAddress),
    publicClient.getBlock({ blockNumber: BigInt(creation.blockNumber) }),
  ]);

  const mint = transfers.find((t) => eq(t.from, ZERO_ADDRESS));
  const mintTimestamp = mint?.timestamp ?? Number(creationBlock.timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenAgeHours = Math.max(0, (nowSeconds - mintTimestamp) / 3600);

  const creatorEarlyAcquired = transfers
    .filter((t) => eq(t.to, creation.contractCreator) && t.timestamp <= mintTimestamp + EARLY_WINDOW_SECONDS)
    .reduce((sum, t) => sum + t.amount, 0n);

  const balances = reconstructBalances(transfers);
  const topEoaHolder = await findTopEoaHolder(balances, tokenAddress);

  const created = await getCreatedContracts(creation.contractCreator);
  const deployerPriorLaunches7d = created.filter(
    (c) =>
      !eq(c.contractAddress, tokenAddress) &&
      c.timestamp < mintTimestamp &&
      c.timestamp >= mintTimestamp - DEPLOYER_LOOKBACK_SECONDS,
  ).length;

  return {
    tokenAgeHours,
    transferCount: transfers.length,
    totalSupply,
    topEoaHolder,
    creator: creation.contractCreator,
    creatorEarlyAcquired,
    deployerPriorLaunches7d,
    verified,
    ownerProbe,
  };
}
