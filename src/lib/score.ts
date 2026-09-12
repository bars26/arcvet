/**
 * ArcVet scoring engine — pure, deterministic. Frozen formula `arcvet-v1.0`,
 * see SPEC.md. Every weight/cap here was checked against real Arc launches
 * (lolpad.fun) before being set — see DECISIONS.md §3-4.
 *
 * This module does no I/O. The read layer (not yet written) is responsible for
 * turning on-chain data into a `TokenSignals` object.
 */

export const FORMULA_VERSION = "arcvet-v1.0";

export type OwnerProbeResult = "no-admin" | "renounced" | "live-owner";

export type TokenSignals = {
  /** hours since the token's first Transfer(0x0 -> ...) */
  tokenAgeHours: number;
  /** total Transfer events observed for the token */
  transferCount: number;
  totalSupply: bigint;
  /**
   * Largest holder that is a plain EOA (eth_getCode == "0x"), excluding the token
   * contract itself. `null` if no EOA holds a nonzero balance (everything still
   * sits in a contract — a pool, a curve, a vesting contract) — only meaningful
   * when `holderDataAvailable` is true; see that field.
   */
  topEoaHolder: { address: `0x${string}`; balance: bigint } | null;
  /**
   * Did the holder-ranking read actually succeed? `false` means the upstream
   * holders endpoint failed (DECISIONS.md §11 — confirmed real, not hypothetical:
   * arc-scan.org's `/v1/tokens/{addr}/holders` returned an internal error for a
   * real token) — `topEoaHolder` is `null` in that case too, but for a *different*
   * reason (unknown, not "checked and found none"), and the term must be dropped,
   * not scored as if concentration were fine.
   */
  holderDataAvailable: boolean;
  creator: `0x${string}`;
  /** amount the creator acquired (any counterparty) within EARLY_WINDOW_HOURS of mint */
  creatorEarlyAcquired: bigint;
  /** # token-like contracts this deployer created in the 7 days before this token */
  deployerPriorLaunches7d: number;
  /** arcscan getsourcecode has a non-empty SourceCode */
  verified: boolean;
  ownerProbe: OwnerProbeResult;
};

export type Confidence = "none" | "low" | "medium" | "high";

export type Term = {
  key: string;
  value: number;
  weight: number;
  applicable: boolean;
  contribution: number;
};

export type ScoreResult = {
  score: number | null;
  confidence: Confidence;
  formulaVersion: typeof FORMULA_VERSION;
  penalty: 0;
  terms: Term[];
  reasons: string[];
};

const WEIGHTS = {
  holderConcentration: 0.4,
  creatorEarlyAccumulation: 0.25,
  deployerLaunchVelocity: 0.2,
  ownershipSurface: 0.1,
  verification: 0.05,
} as const;

const HOLDER_CONCENTRATION_CAP = 0.5; // an EOA holding >=50% of supply is maximally risky
const CREATOR_EARLY_CAP = 0.2; // creator acquiring >=20% of supply early is maximally risky
const EARLY_WINDOW_HOURS = 24;
const VELOCITY_CAP = 3; // 3+ prior launches in 7 days is maximally risky

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const shareOf = (part: bigint, total: bigint) => (total > 0n ? Number(part) / Number(total) : 0);

/** Score a single token from its precomputed on-chain signals. Pure, deterministic. */
export function scoreToken(s: TokenSignals): ScoreResult {
  const reasons: string[] = [];
  const terms: Term[] = [];

  // Always records `reason` — including why a term was dropped. An inapplicable
  // term with a silent explanation defeats the point of an "advisory, explainable"
  // score: found while adding the holder-data-unavailable case (DECISIONS.md §11)
  // that the "too early to assess" case above it had the same silent-drop bug.
  const push = (key: string, weight: number, applicable: boolean, value: number, reason: string) => {
    terms.push({ key, value, weight, applicable, contribution: applicable ? value * weight : 0 });
    reasons.push(reason);
  };

  // holderConcentration
  {
    const applicable = s.transferCount > 0 && s.holderDataAvailable;
    const topEoaShare = s.topEoaHolder ? shareOf(s.topEoaHolder.balance, s.totalSupply) : 0;
    const value = clamp01(1 - topEoaShare / HOLDER_CONCENTRATION_CAP);
    const reason = !s.holderDataAvailable
      ? "Holder data unavailable — this term was dropped, not assumed safe"
      : s.topEoaHolder
        ? `Largest non-pool holder owns ${pct(topEoaShare)} of supply — a plain wallet, not a contract`
        : "No single wallet holds a concentrated share — supply sits in contracts (pool/curve/vesting)";
    push("holderConcentration", WEIGHTS.holderConcentration, applicable, value, reason);
  }

  // creatorEarlyAccumulation
  {
    const applicable = s.tokenAgeHours >= 1;
    const earlyShare = shareOf(s.creatorEarlyAcquired, s.totalSupply);
    const value = clamp01(1 - earlyShare / CREATOR_EARLY_CAP);
    const reason =
      earlyShare > 0
        ? `Creator acquired ${pct(earlyShare)} of supply within ${EARLY_WINDOW_HOURS}h of launch`
        : `Creator did not accumulate supply within ${EARLY_WINDOW_HOURS}h of launch`;
    push(
      "creatorEarlyAccumulation",
      WEIGHTS.creatorEarlyAccumulation,
      applicable,
      value,
      applicable ? reason : "Too early to assess creator behavior (token is under 1h old)",
    );
  }

  // deployerLaunchVelocity
  {
    const value = clamp01(1 - s.deployerPriorLaunches7d / VELOCITY_CAP);
    const reason =
      s.deployerPriorLaunches7d === 0
        ? "First launch from this deployer in the last 7 days"
        : `Deployer launched ${s.deployerPriorLaunches7d} other token(s) in the 7 days around this one`;
    push("deployerLaunchVelocity", WEIGHTS.deployerLaunchVelocity, true, value, reason);
  }

  // ownershipSurface
  {
    const value = s.ownerProbe === "live-owner" ? 0.4 : 1;
    const reason =
      s.ownerProbe === "no-admin"
        ? "No owner()/admin function detected on this contract"
        : s.ownerProbe === "renounced"
          ? "Ownership has been renounced (owner() == address(0))"
          : "Owner is a live address — a real privileged-call surface exists";
    push("ownershipSurface", WEIGHTS.ownershipSurface, true, value, reason);
  }

  // verification
  {
    const value = s.verified ? 1 : 0.5;
    const reason = s.verified
      ? "Contract source is verified on arcscan"
      : "Contract is not verified on arcscan (common for clone-factory launches, not inherently suspicious)";
    push("verification", WEIGHTS.verification, true, value, reason);
  }

  const applicableTerms = terms.filter((t) => t.applicable);
  const weightSum = applicableTerms.reduce((a, t) => a + t.weight, 0);
  const base = weightSum > 0 ? applicableTerms.reduce((a, t) => a + t.contribution, 0) / weightSum : null;

  const confidence = confidenceOf(s.tokenAgeHours, s.transferCount);
  reasons.push(`Confidence: ${confidence} (${s.tokenAgeHours.toFixed(1)}h old, ${s.transferCount} transfers)`);

  return {
    score: base === null ? null : Math.round(100 * base),
    confidence,
    formulaVersion: FORMULA_VERSION,
    penalty: 0,
    terms,
    reasons,
  };
}

function confidenceOf(tokenAgeHours: number, transferCount: number): Confidence {
  if (transferCount === 0) return "none";
  if (tokenAgeHours < 24 || transferCount < 5) return "low";
  if (tokenAgeHours < 24 * 7 || transferCount < 20) return "medium";
  return "high";
}
