"use client";

import { useState } from "react";
import type { Address } from "viem";
import CommunityReports from "./CommunityReports";

const EXPLORER = "https://arc-scan.org";
const PRESETS = [
  { label: "WARP (warp)", address: "0x384c60f98ecd4c26345499345c03d677e40f115e" },
  { label: "Argus (tolly)", address: "0xece5ca8bf9220718e5727754026757512212cb3c" },
  { label: "ACAT (tolly)", address: "0xf80457274fa646c7a8e0942d48be703864ef3d01" },
];

type Confidence = "none" | "low" | "medium" | "high";
type Term = { key: string; value: number; weight: number; applicable: boolean; contribution: number };
type OwnerProbe = "no-admin" | "renounced" | "live-owner";

type CheckResult = {
  address: string;
  creator: string;
  tokenAgeHours: number;
  transferCount: number;
  totalSupply: string;
  topEoaHolder: { address: string; balance: string } | null;
  verified: boolean;
  ownerProbe: OwnerProbe;
  deployerPriorLaunches7d: number;
  score: number | null;
  confidence: Confidence;
  formulaVersion: string;
  terms: Term[];
  reasons: string[];
};

const CONF_STYLE: Record<Confidence, string> = {
  none: "border-slate-700 bg-slate-800 text-slate-400",
  low: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  medium: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  high: "border-emerald-400/50 bg-emerald-400/15 text-emerald-300",
};

const OWNER_LABEL: Record<OwnerProbe, string> = {
  "no-admin": "no admin function",
  renounced: "ownership renounced",
  "live-owner": "live owner address",
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const scoreColor = (score: number | null) =>
  score === null
    ? "text-slate-500"
    : score >= 70
      ? "text-emerald-300"
      : score >= 40
        ? "text-amber-300"
        : "text-red-400";

export default function Home() {
  const [input, setInput] = useState("");
  const [data, setData] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async (address: string) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const r = await fetch(`/api/check?address=${address}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      setData(j as CheckResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (/^0x[0-9a-fA-F]{40}$/.test(input.trim())) void runCheck(input.trim());
    else setError("paste a 0x… token address");
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight">
            Arc<span className="text-emerald-400">Vet</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Paste a token address on Arc — get an explainable trust score from on-chain history, no
            submitted evidence needed.
          </p>
        </header>

        <form onSubmit={submit} className="mb-4 flex flex-wrap items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="0x… token address on Arc"
            className="w-full flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm outline-none focus:border-emerald-400 sm:w-auto"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-50"
          >
            {loading ? "Checking…" : "Check"}
          </button>
        </form>

        <div className="mb-6 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">real launches (Warp, Tolly):</span>
          {PRESETS.map((p) => (
            <button
              key={p.address}
              type="button"
              onClick={() => {
                setInput(p.address);
                void runCheck(p.address);
              }}
              className="rounded-md border border-slate-700 px-2.5 py-1 text-slate-400 transition hover:border-emerald-400 hover:text-emerald-300"
            >
              {p.label}
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-slate-400">Scanning Arc…</p>}
        {error && (
          <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}

        {data && !loading && <ResultPanel data={data} />}

        <footer className="mt-16 border-t border-slate-800 pt-6 text-xs text-slate-600">
          {data && <>formula {data.formulaVersion} · </>}
          ArcVet scores are advisory, not a guarantee.{" "}
          <a
            href="https://github.com/bars26/arcvet/blob/main/SPEC.md"
            className="underline hover:text-slate-400"
          >
            spec
          </a>
        </footer>
      </div>
    </main>
  );
}

function ResultPanel({ data }: { data: CheckResult }) {
  const totalSupply = BigInt(data.totalSupply);
  const topEoaPct = data.topEoaHolder
    ? (Number(BigInt(data.topEoaHolder.balance) * 10000n) / Number(totalSupply)) / 100
    : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">Trust score</p>
            <div className="mt-1 flex items-end gap-3">
              <span className={`text-5xl font-bold ${scoreColor(data.score)}`}>{data.score ?? "—"}</span>
              <span
                className={`mb-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${CONF_STYLE[data.confidence]}`}
              >
                {data.confidence}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            <Mini label="age" value={data.tokenAgeHours < 24 ? `${data.tokenAgeHours.toFixed(1)}h` : `${(data.tokenAgeHours / 24).toFixed(1)}d`} />
            <Mini label="transfers" value={data.transferCount} />
            <Mini label="top EOA" value={topEoaPct === null ? "—" : `${topEoaPct.toFixed(1)}%`} />
          </div>
        </div>

        <a
          href={`${EXPLORER}/token/${data.address}`}
          className="mt-3 block text-xs text-slate-400 hover:text-emerald-300"
        >
          {data.address} on arcscan
        </a>
        <a
          href={`${EXPLORER}/address/${data.creator}`}
          className="mt-1 block text-xs text-slate-500 hover:text-emerald-300"
        >
          creator {short(data.creator)}
        </a>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Terms</p>
        <div className="space-y-3">
          {data.terms.map((t) => (
            <div key={t.key}>
              <div className="mb-1 flex justify-between text-xs">
                <span className={t.applicable ? "text-slate-300" : "text-slate-600"}>
                  {t.key}
                  <span className="ml-1 text-slate-600">w{t.weight}</span>
                </span>
                <span className="text-slate-500">
                  {t.applicable ? `${t.value.toFixed(2)} → +${(t.contribution * 100).toFixed(1)}` : "not applicable"}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full ${t.applicable ? "bg-emerald-400" : "bg-slate-700"}`}
                  style={{ width: `${Math.round((t.applicable ? t.value : 0) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Why this score</p>
        <ul className="space-y-1 text-sm text-slate-300">
          {data.reasons.map((r, i) => (
            <li key={i}>· {r}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Raw signals</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-400 sm:grid-cols-3">
          <Field label="verified" value={data.verified ? "yes" : "no"} />
          <Field label="ownership" value={OWNER_LABEL[data.ownerProbe]} />
          <Field label="deployer launches (7d)" value={data.deployerPriorLaunches7d} />
        </dl>
      </div>

      <CommunityReports key={data.address} subject={data.address as Address} />
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-slate-950 px-3 py-2">
      <p className="text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-slate-300">{value}</dd>
    </div>
  );
}
