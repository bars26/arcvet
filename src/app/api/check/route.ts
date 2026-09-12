import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Address } from "viem";
import { getTokenSignals } from "@/lib/tokenSignals";
import { scoreToken } from "@/lib/score";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** BigInt-safe JSON: stringify bigints as decimal strings. */
function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function json(data: unknown, status = 200): NextResponse {
  return new NextResponse(JSON.stringify(data, replacer, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  if (!address || !ADDRESS_RE.test(address)) {
    return json({ error: "missing or invalid ?address (expected a 0x… token address)" }, 400);
  }

  let signals;
  try {
    signals = await getTokenSignals(address as Address);
  } catch (e) {
    return json({ error: "could not read this address", detail: (e as Error).message }, 422);
  }

  try {
    const result = scoreToken(signals);
    return json({
      address,
      creator: signals.creator,
      tokenAgeHours: signals.tokenAgeHours,
      transferCount: signals.transferCount,
      totalSupply: signals.totalSupply,
      topEoaHolder: signals.topEoaHolder,
      verified: signals.verified,
      ownerProbe: signals.ownerProbe,
      deployerPriorLaunches7d: signals.deployerPriorLaunches7d,
      ...result,
    });
  } catch (e) {
    return json({ error: "scoring failed", detail: (e as Error).message }, 500);
  }
}
