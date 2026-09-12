"use client";

import { useEffect, useState } from "react";
import { toHex, type Address } from "viem";
import { buildReportMessage, REPORT_CATEGORIES, type ReportCategory } from "@/lib/evidence";

type StoredReport = {
  id: string;
  subject: string;
  reporter: string;
  category: ReportCategory;
  description: string;
  evidenceUri?: string;
  timestamp: number;
  receivedAt: number;
};

const CATEGORY_LABEL: Record<ReportCategory, string> = {
  rug_pull: "Rug pull",
  honeypot: "Honeypot",
  hidden_backdoor: "Hidden backdoor",
  team_disappeared: "Team disappeared",
  confirmed_legit: "Confirmed legit",
  other: "Other",
};
const CATEGORY_STYLE: Record<ReportCategory, string> = {
  rug_pull: "border-red-400/30 bg-red-400/10 text-red-300",
  honeypot: "border-red-400/30 bg-red-400/10 text-red-300",
  hidden_backdoor: "border-red-400/30 bg-red-400/10 text-red-300",
  team_disappeared: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  confirmed_legit: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  other: "border-slate-600 bg-slate-800 text-slate-300",
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Minimal EIP-1193 surface — no wallet-connection library, same "just viem, no
// unnecessary dependencies" approach as the rest of ArcVet/ProofGraph.
type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null;
}

export default function CommunityReports({ subject }: { subject: Address }) {
  const [reports, setReports] = useState<StoredReport[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<ReportCategory>("rug_pull");
  const [description, setDescription] = useState("");
  const [evidenceUri, setEvidenceUri] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReports = async () => {
    const r = await fetch(`/api/reports?subject=${subject}`);
    const j = await r.json();
    setReports(r.ok ? j.reports : []);
  };

  // `key={subject}` on the parent's usage of this component remounts it (and
  // resets all state) when the subject changes, so this only needs to run once.
  useEffect(() => {
    // fetch-on-mount is the correct pattern here; the parent's `key={subject}`
    // remounts this component (resetting state) whenever `subject` changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const provider = getInjectedProvider();
    if (!provider) {
      setError("No wallet found — install a browser wallet (e.g. MetaMask) to sign a report.");
      return;
    }
    if (description.trim().length === 0) {
      setError("Description can't be empty.");
      return;
    }
    setSubmitting(true);
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const reporter = accounts[0] as Address;
      const timestamp = Math.floor(Date.now() / 1000);
      const input = { subject, reporter, category, description: description.trim(), evidenceUri: evidenceUri.trim() || undefined, timestamp };
      const message = buildReportMessage(input);
      const signature = (await provider.request({
        method: "personal_sign",
        params: [toHex(message), reporter],
      })) as string;

      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, signature }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || `HTTP ${res.status}`);

      setDescription("");
      setEvidenceUri("");
      setShowForm(false);
      await loadReports();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Community reports</p>
          <p className="mt-1 text-xs text-slate-500">
            Advisory only — not scored. What the automatic signals above can&apos;t see: off-chain
            facts, a deeper code finding, anything you verified yourself.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-emerald-400 hover:text-emerald-300"
        >
          {showForm ? "Cancel" : "Report this address"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ReportCategory)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-400"
          >
            {REPORT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What did you see that the automatic score wouldn't catch?"
            rows={3}
            maxLength={2000}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-400"
          />
          <input
            value={evidenceUri}
            onChange={(e) => setEvidenceUri(e.target.value)}
            placeholder="Evidence link (optional) — a screenshot, tx, thread"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-400"
          />
          {error && <p className="text-xs text-red-300">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg border border-emerald-400/50 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-50"
          >
            {submitting ? "Signing…" : "Sign & submit with wallet"}
          </button>
        </form>
      )}

      <div className="mt-4 space-y-3">
        {reports === null && <p className="text-xs text-slate-500">Loading reports…</p>}
        {reports?.length === 0 && <p className="text-xs text-slate-500">No community reports yet.</p>}
        {reports?.map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLE[r.category]}`}>
                {CATEGORY_LABEL[r.category]}
              </span>
              <span className="text-xs text-slate-600">
                {short(r.reporter)} · {new Date(r.timestamp * 1000).toLocaleDateString()}
              </span>
            </div>
            <p className="mt-2 text-slate-300">{r.description}</p>
            {r.evidenceUri && (
              <a href={r.evidenceUri} className="mt-1 block text-xs text-slate-500 hover:text-emerald-300">
                evidence ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
