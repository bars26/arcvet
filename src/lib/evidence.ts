/**
 * Phase 2 — community evidence. Pure logic: message format + signature
 * verification. No I/O (storage lives in reportStore.ts, same split as
 * score.ts/tokenSignals.ts in Phase 1).
 *
 * Frozen decision (discussed with the user before writing this): community
 * reports are advisory and **do not feed `scoreToken`** (score.ts, formula
 * arcvet-v1.0) at all. Phase 1's automatic score is deterministic and hard to
 * game; blending in unweighted community input before any sybil-resistance
 * design exists would make the whole number gameable by the people with the
 * strongest incentive to game it (a rug's own deployer, or a competitor). This
 * layer exists to surface what the automatic signals structurally *can't* see —
 * off-chain facts (team disappeared, socials went dark) or a deeper code finding
 * our generic probes miss (a disguised admin function) — not to re-score what
 * Phase 1 already measures on-chain.
 */
import { verifyMessage, type Address } from "viem";

export const REPORT_CATEGORIES = [
  "rug_pull",
  "honeypot",
  "hidden_backdoor",
  "team_disappeared",
  "confirmed_legit",
  "other",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export function isReportCategory(x: string): x is ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(x);
}

export type ReportInput = {
  subject: Address; // the token or deployer address the report is about
  reporter: Address; // claimed signer — verified against the signature below
  category: ReportCategory;
  description: string; // free text, what Phase 1's automatic signals can't see
  evidenceUri?: string; // optional link (screenshot, tx, thread) backing the claim
  timestamp: number; // unix seconds, chosen by the client, part of the signed message
};

const MAX_DESCRIPTION_LENGTH = 2000;

/**
 * The exact string a reporter's wallet signs (EIP-191 personal_sign). Field
 * order and format are frozen — changing this invalidates every signature
 * verification for reports signed under the old format.
 */
export function buildReportMessage(r: ReportInput): string {
  return [
    "ArcVet Community Report",
    `subject: ${r.subject}`,
    `category: ${r.category}`,
    `description: ${r.description}`,
    `evidence: ${r.evidenceUri ?? ""}`,
    `timestamp: ${r.timestamp}`,
  ].join("\n");
}

export type ValidationError =
  | "bad_subject"
  | "bad_reporter"
  | "bad_category"
  | "empty_description"
  | "description_too_long"
  | "stale_timestamp"
  | "future_timestamp";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const MAX_AGE_SECONDS = 10 * 60; // a signature is only good for 10 minutes past its own timestamp

/** Structural checks that don't need a signature — cheap, run before verifying it. */
export function validateReportInput(r: ReportInput): ValidationError | null {
  if (!ADDRESS_RE.test(r.subject)) return "bad_subject";
  if (!ADDRESS_RE.test(r.reporter)) return "bad_reporter";
  if (!isReportCategory(r.category)) return "bad_category";
  if (r.description.trim().length === 0) return "empty_description";
  if (r.description.length > MAX_DESCRIPTION_LENGTH) return "description_too_long";
  const now = Math.floor(Date.now() / 1000);
  if (r.timestamp > now + MAX_CLOCK_SKEW_SECONDS) return "future_timestamp";
  if (r.timestamp < now - MAX_AGE_SECONDS) return "stale_timestamp";
  return null;
}

/** Does `signature` genuinely come from `r.reporter` signing this exact report? */
export async function verifyReportSignature(r: ReportInput, signature: `0x${string}`): Promise<boolean> {
  try {
    return await verifyMessage({ address: r.reporter, message: buildReportMessage(r), signature });
  } catch {
    return false;
  }
}
