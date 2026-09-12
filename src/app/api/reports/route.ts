import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Address } from "viem";
import {
  buildReportMessage,
  validateReportInput,
  verifyReportSignature,
  type ReportInput,
} from "@/lib/evidence";
import {
  addReport,
  getReportsFor,
  countReportsByReporterToday,
  MAX_REPORTS_PER_REPORTER_PER_DAY,
} from "@/lib/reportStore";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** GET /api/reports?subject=0x... — community reports for one token/deployer. */
export async function GET(request: NextRequest) {
  const subject = request.nextUrl.searchParams.get("subject")?.trim();
  if (!subject || !ADDRESS_RE.test(subject)) {
    return json({ error: "missing or invalid ?subject" }, 400);
  }
  return json({ reports: getReportsFor(subject as Address) });
}

/**
 * POST /api/reports — submit a signed community report. Not scored (evidence.ts):
 * advisory only, shown alongside the automatic score, never blended into it.
 */
export async function POST(request: NextRequest) {
  let body: Partial<ReportInput> & { signature?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const { subject, reporter, category, description, evidenceUri, timestamp, signature } = body;
  if (
    !subject ||
    !reporter ||
    !category ||
    description === undefined ||
    timestamp === undefined ||
    !signature
  ) {
    return json({ error: "missing field(s): subject, reporter, category, description, timestamp, signature" }, 400);
  }
  if (!signature.startsWith("0x")) {
    return json({ error: "signature must be a 0x-prefixed hex string" }, 400);
  }

  const input: ReportInput = {
    subject: subject as Address,
    reporter: reporter as Address,
    category: category as ReportInput["category"],
    description,
    evidenceUri,
    timestamp,
  };

  const validationError = validateReportInput(input);
  if (validationError) {
    return json({ error: validationError, message: buildReportMessage(input) }, 400);
  }

  if (countReportsByReporterToday(input.reporter) >= MAX_REPORTS_PER_REPORTER_PER_DAY) {
    return json({ error: "rate_limited", detail: `max ${MAX_REPORTS_PER_REPORTER_PER_DAY} reports/day per reporter` }, 429);
  }

  const validSignature = await verifyReportSignature(input, signature as `0x${string}`);
  if (!validSignature) {
    return json({ error: "invalid_signature", message: buildReportMessage(input) }, 401);
  }

  addReport({
    id: crypto.randomUUID(),
    ...input,
    signature: signature as `0x${string}`,
    receivedAt: Date.now(),
  });

  return json({ ok: true });
}
