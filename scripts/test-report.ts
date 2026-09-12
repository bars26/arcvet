/**
 * End-to-end check for Phase 2's community-report signing flow: generates a
 * throwaway wallet, signs a report exactly the way the browser's injected
 * wallet does (personal_sign over buildReportMessage's output), and posts it
 * to a running dev server. Validates the whole pipeline — signature
 * verification, validation, storage, retrieval — without a real browser wallet.
 *   npx tsx scripts/test-report.ts
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { buildReportMessage, type ReportInput } from "../src/lib/evidence";

const BASE = process.env.PROOFGRAPH_BASE_URL ?? "http://localhost:3200";
const SUBJECT = "0x384c60f98ecd4c26345499345c03d677e40f115e"; // WARP

const account = privateKeyToAccount(generatePrivateKey());
console.log("test reporter:", account.address);

const input: ReportInput = {
  subject: SUBJECT as `0x${string}`,
  reporter: account.address,
  category: "confirmed_legit",
  description: "End-to-end test report from scripts/test-report.ts — safe to ignore/delete.",
  evidenceUri: undefined,
  timestamp: Math.floor(Date.now() / 1000),
};
const message = buildReportMessage(input);
const signature = await account.signMessage({ message });

console.log("\n1. submitting a valid signed report...");
const post = await fetch(`${BASE}/api/reports`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...input, signature }),
});
const postBody = await post.json();
console.log(post.status === 200 ? "PASS" : "FAIL", "submit ->", post.status, JSON.stringify(postBody));

console.log("\n2. reading it back...");
const get = await fetch(`${BASE}/api/reports?subject=${SUBJECT}`);
const getBody = (await get.json()) as { reports: Array<{ reporter: string; description: string }> };
const found = getBody.reports.some((r) => r.reporter.toLowerCase() === account.address.toLowerCase());
console.log(found ? "PASS" : "FAIL", `submitted report present in GET (${getBody.reports.length} total for subject)`);

console.log("\n3. tampered signature must be rejected...");
const badSig = signature.slice(0, -4) + "0000";
const tampered = await fetch(`${BASE}/api/reports`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...input, timestamp: Math.floor(Date.now() / 1000), signature: badSig }),
});
console.log(tampered.status === 401 ? "PASS" : "FAIL", "tampered signature ->", tampered.status);

console.log("\n4. wrong reporter (signature doesn't match claimed address) must be rejected...");
const otherAccount = privateKeyToAccount(generatePrivateKey());
const wrongReporterInput = { ...input, reporter: otherAccount.address, timestamp: Math.floor(Date.now() / 1000) };
const sigForOriginal = await account.signMessage({ message: buildReportMessage(wrongReporterInput) });
// sign correctly for wrongReporterInput's message, but claim a DIFFERENT reporter than who actually signed
const impersonation = await fetch(`${BASE}/api/reports`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...wrongReporterInput, reporter: SUBJECT, signature: sigForOriginal }),
});
console.log(impersonation.status === 401 ? "PASS" : "FAIL", "impersonation ->", impersonation.status);
