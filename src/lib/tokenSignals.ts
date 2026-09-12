/**
 * Turns raw Arc (chain 5042) data into the `TokenSignals` shape `scoreToken`
 * (src/lib/score.ts) expects. All I/O lives here; score.ts stays pure. See
 * SPEC.md §2 for the contract.
 */
import type { Address } from "viem";
import {
  getContractCreation,
  getEarlyTransfers,
  getTopHolders,
  getCreatedContracts,
  isVerified,
  isContractAddress,
  probeOwner,
  getTotalSupply,
} from "./arc";
import type { TokenSignals } from "./score";

const EARLY_WINDOW_SECONDS = 24 * 60 * 60;
const DEPLOYER_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;
const TOP_HOLDER_CANDIDATES = 10; // how many ranked holders to EOA-check before giving up

// The canonical "burn" address: unspendable by convention, technically a codeless
// EOA so isContractAddress says no — but tokens sent here are permanently removed
// from circulation, the opposite of a risky whale. Found by hand checking Argus
// (LAUNCHPADS.md): its top holder was 0x...dead, which would otherwise have read
// as "63% in one risky wallet" for what is actually a deflationary burn.
const BURN_ADDRESS = "0x000000000000000000000000000000000000dead";

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

type TopHolderResult = { holder: { address: `0x${string}`; balance: bigint } | null; available: boolean };

/**
 * `available: false` means the holders endpoint itself failed (arc.ts —
 * confirmed real on BARC, DECISIONS.md §11), not "checked, found nothing" — the
 * caller must drop the holderConcentration term, not score it as if supply were
 * safely spread out.
 */
async function findTopEoaHolder(tokenAddress: Address): Promise<TopHolderResult> {
  let ranked;
  try {
    ranked = await getTopHolders(tokenAddress, TOP_HOLDER_CANDIDATES);
  } catch {
    return { holder: null, available: false };
  }
  for (const holder of ranked) {
    if (
      holder.balance > 0n &&
      !eq(holder.address, tokenAddress) &&
      !eq(holder.address, BURN_ADDRESS) &&
      !(await isContractAddress(holder.address))
    ) {
      return { holder, available: true };
    }
  }
  return { holder: null, available: true };
}

/** Fetch + assemble everything `scoreToken` needs for one token address. */
export async function getTokenSignals(tokenAddress: Address): Promise<TokenSignals> {
  const creation = await getContractCreation(tokenAddress);
  if (!creation) {
    throw new Error(
      `could not find activity for ${tokenAddress} — not indexed yet, or not a contract`,
    );
  }
  const mintTimestamp = creation.timestamp;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenAgeHours = Math.max(0, (nowSeconds - mintTimestamp) / 3600);

  const [
    { transfers: earlyTransfers, totalTransferCount },
    verified,
    ownerProbe,
    totalSupply,
    { holder: topEoaHolder, available: holderDataAvailable },
    created,
  ] = await Promise.all([
    getEarlyTransfers(tokenAddress, mintTimestamp + EARLY_WINDOW_SECONDS),
    isVerified(tokenAddress),
    probeOwner(tokenAddress),
    getTotalSupply(tokenAddress),
    findTopEoaHolder(tokenAddress),
    getCreatedContracts(creation.contractCreator),
  ]);

  const creatorEarlyAcquired = earlyTransfers
    .filter((t) => eq(t.to, creation.contractCreator))
    .reduce((sum, t) => sum + t.amount, 0n);

  // Excluded by timestamp, not address: a factory-pattern launch (Warp, lolpad) has
  // no resolvable contractAddress in this list (arc.ts) — the creation timestamp
  // equals the launch tx's block timestamp exactly, so `< mintTimestamp` already
  // drops the token's own launch without needing its address.
  const deployerPriorLaunches7d = created.filter(
    (c) => c.timestamp < mintTimestamp && c.timestamp >= mintTimestamp - DEPLOYER_LOOKBACK_SECONDS,
  ).length;

  return {
    tokenAgeHours,
    transferCount: totalTransferCount,
    totalSupply,
    topEoaHolder,
    holderDataAvailable,
    creator: creation.contractCreator,
    creatorEarlyAcquired,
    deployerPriorLaunches7d,
    verified,
    ownerProbe,
  };
}
