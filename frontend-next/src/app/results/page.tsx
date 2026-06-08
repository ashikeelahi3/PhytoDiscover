"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getJobs, getJob, getResults, getResultsCsvUrl, getPoseFile } from "@/lib/api";
import type { DockingJob, Result } from "@/lib/types";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/Badge";
import { ProteinViewer } from "@/components/ProteinViewer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, d: number) {
  return v == null ? "—" : v.toFixed(d);
}

type ScoreStrength = "Strong" | "Moderate" | "Weak" | "Unknown";

function scoreStrength(score: number | null): ScoreStrength {
  if (score == null) return "Unknown";
  if (score <= -9) return "Strong";
  if (score <= -7) return "Moderate";
  return "Weak";
}

const STRENGTH_STYLE: Record<ScoreStrength, { bg: string; color: string }> = {
  Strong:   { bg: "rgba(74,222,128,0.12)",  color: "#4ade80" },
  Moderate: { bg: "rgba(251,191,36,0.12)",  color: "#fbbf24" },
  Weak:     { bg: "rgba(100,116,139,0.12)", color: "#64748b" },
  Unknown:  { bg: "rgba(100,116,139,0.12)", color: "#64748b" },
};

function barFill(rawScore: number | null, selected: boolean): string {
  if (selected) return "#14b8a6";
  if (rawScore == null) return "#475569";
  if (rawScore <= -9) return "#4ade80";
  if (rawScore <= -7) return "#fbbf24";
  return "#475569";
}

type SortKey = "rank" | "name" | "score" | "rmsd_lower" | "rmsd_upper" | "h_bonds";
type SortDir = "asc" | "desc";
type ViewMode = "cartoon" | "surface" | "stick";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── ChartTooltip ──────────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { rawScore: number | null; name: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      className="rounded px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      <p className="font-medium mb-0.5 max-w-[200px]" style={{ color: "var(--text-primary)" }}>
        {d.name}
      </p>
      <p className="font-mono" style={{ color: "#14b8a6" }}>
        {fmt(d.rawScore, 1)} kcal/mol
      </p>
    </div>
  );
}

// ── SortTh ────────────────────────────────────────────────────────────────────

function SortTh({
  label, col, sort, dir, onClick, right,
}: {
  label: string; col: SortKey; sort: SortKey; dir: SortDir;
  onClick: (c: SortKey) => void; right?: boolean;
}) {
  const active = sort === col;
  return (
    <th
      className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap"
      style={{
        textAlign: right ? "right" : "left",
        color: active ? "#14b8a6" : "var(--text-muted)",
      }}
      onClick={() => onClick(col)}
    >
      {label}{" "}
      <span className="font-mono text-[9px]">
        {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
      </span>
    </th>
  );
}

// ── CompoundInfo ──────────────────────────────────────────────────────────────

function CompoundInfo({ result }: { result: Result & { rank: number } }) {
  const strength = scoreStrength(result.binding_score);
  const s = STRENGTH_STYLE[strength];
  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border)" }}
    >
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
          Selected compound
        </p>
        <p className="text-sm font-semibold leading-snug" style={{ color: "var(--text-primary)" }} title={result.compound_name}>
          {result.compound_name}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
          Rank #{result.rank}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div
          className="col-span-2 flex items-center justify-between rounded p-2.5"
          style={{ backgroundColor: "var(--bg-card-inner)", border: "1px solid var(--border)" }}
        >
          <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Binding score
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {fmt(result.binding_score, 1)} kcal/mol
            </span>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{ backgroundColor: s.bg, color: s.color }}
            >
              {strength}
            </span>
          </div>
        </div>

        {[
          { label: "RMSD lower", value: fmt(result.rmsd_lower, 2) },
          { label: "RMSD upper", value: fmt(result.rmsd_upper, 2) },
          { label: "H-bonds",    value: String(result.h_bond_count ?? "—") },
          { label: "Pose file",  value: result.pose_file ? "Available" : "None" },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded p-2"
            style={{ backgroundColor: "var(--bg-card-inner)", border: "1px solid var(--border)" }}
          >
            <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "var(--text-muted)" }}>
              {label}
            </p>
            <p className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
              {value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AffinityBar ───────────────────────────────────────────────────────────────

function AffinityBar({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  const pct = Math.min(100, Math.max(0, (Math.abs(score) / 12) * 100));
  const color = score <= -9 ? "#4ade80" : score <= -7 ? "#fbbf24" : "#475569";
  return (
    <div className="flex items-center gap-2">
      <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--border)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
        {fmt(score, 1)}
      </span>
    </div>
  );
}

// ── JobListItem ───────────────────────────────────────────────────────────────

function JobListItem({
  job,
  active,
  proteinCode,
  onClick,
}: {
  job: DockingJob;
  active: boolean;
  proteinCode: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer border-0"
      style={{
        backgroundColor: active ? "rgba(20,184,166,0.1)" : "transparent",
        border: `1px solid ${active ? "rgba(20,184,166,0.4)" : "var(--border)"}`,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-xs font-semibold" style={{ color: active ? "#14b8a6" : "var(--text-primary)" }}>
          {proteinCode || job.id.slice(0, 8)}
        </span>
        <div className="flex-1" />
        <StatusBadge status={job.status} />
      </div>
      <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
        {relativeTime(job.created_at)} · {job.id.slice(0, 8)}…
      </div>
    </button>
  );
}

// ── Results panel (for a single job) ─────────────────────────────────────────

function ResultsPanel({ jobId, proteinCode }: { jobId: string; proteinCode: string }) {
  const [sort, setSort] = useState<SortKey>("rank");
  const [dir, setDir] = useState<SortDir>("asc");
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [poseContent, setPoseContent] = useState<string | null>(null);
  const [poseLoading, setPoseLoading] = useState(false);
  const [viewerMode, setViewerMode] = useState<ViewMode>("cartoon");

  const { data: job } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "done" || s === "failed" ? false : 4000;
    },
  });

  const { data: results, isLoading: resultsLoading } = useQuery({
    queryKey: ["results", jobId],
    queryFn: () => getResults(jobId),
    enabled: job?.status === "done",
  });

  useEffect(() => {
    if (!selectedResultId) { setPoseContent(null); return; }
    let cancelled = false;
    setPoseLoading(true);
    getPoseFile(selectedResultId)
      .then((text) => { if (!cancelled) setPoseContent(text); })
      .catch(() => { if (!cancelled) setPoseContent(null); })
      .finally(() => { if (!cancelled) setPoseLoading(false); });
    return () => { cancelled = true; };
  }, [selectedResultId]);

  const ranked = useMemo<(Result & { rank: number })[]>(() => {
    if (!results) return [];
    return [...results]
      .sort((a, b) => (a.binding_score ?? 0) - (b.binding_score ?? 0))
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [results]);

  const sorted = useMemo(() => {
    return [...ranked].sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sort) {
        case "rank":       av = a.rank;                        bv = b.rank;                        break;
        case "name":       av = a.compound_name.toLowerCase(); bv = b.compound_name.toLowerCase(); break;
        case "score":      av = a.binding_score ?? 0;          bv = b.binding_score ?? 0;          break;
        case "rmsd_lower": av = a.rmsd_lower ?? 0;             bv = b.rmsd_lower ?? 0;             break;
        case "rmsd_upper": av = a.rmsd_upper ?? 0;             bv = b.rmsd_upper ?? 0;             break;
        case "h_bonds":    av = a.h_bond_count ?? 0;           bv = b.h_bond_count ?? 0;           break;
        default:           av = a.rank;                        bv = b.rank;
      }
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [ranked, sort, dir]);

  const chartData = useMemo(
    () => ranked.map((r) => ({
      id: r.id,
      name: r.compound_name.length > 20 ? r.compound_name.slice(0, 19) + "…" : r.compound_name,
      absScore: Math.abs(r.binding_score ?? 0),
      rawScore: r.binding_score,
    })),
    [ranked]
  );

  const bestScore = ranked.length > 0 ? ranked[0].binding_score : null;
  const avgScore = ranked.length > 0
    ? ranked.reduce((s, r) => s + (r.binding_score ?? 0), 0) / ranked.length
    : null;
  const hBondCount = ranked.filter((r) => (r.h_bond_count ?? 0) >= 2).length;
  const selectedResult = ranked.find((r) => r.id === selectedResultId) ?? null;
  const chartHeight = Math.max(80, ranked.length * 24);

  function toggleSort(col: SortKey) {
    if (sort === col) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(col); setDir("asc"); }
  }

  function downloadPose(result: Result) {
    if (!poseContent) return;
    const safeName = result.compound_name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const score = result.binding_score != null ? Math.abs(result.binding_score).toFixed(1) : "unk";
    const fileName = `${safeName}_${proteinCode || "protein"}_${score}.pdbqt`;
    const blob = new Blob([poseContent], { type: "chemical/x-pdbqt" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  }

  const cardStyle = {
    backgroundColor: "var(--bg-card)",
    border: "1px solid var(--border)",
  };

  // ── Status states ──────────────────────────────────────────────────────────

  if (!job) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-lg font-semibold mb-2" style={{ color: "#ef4444" }}>Job failed</p>
        {job.error_message && (
          <p className="text-xs font-mono max-w-lg break-all" style={{ color: "var(--text-muted)" }}>
            {job.error_message}
          </p>
        )}
      </div>
    );
  }

  if (job.status !== "done") {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
        <Spinner size="lg" />
        <StatusBadge status={job.status} />
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Results will appear here when the job completes.
        </p>
      </div>
    );
  }

  if (resultsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
          No results
        </p>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          The job completed but returned no binding scores.
        </p>
      </div>
    );
  }

  // ── Main results render ────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Results",       value: ranked.length,                                   color: "#14b8a6" },
          { label: "Best (kcal/mol)", value: bestScore != null ? bestScore.toFixed(1) : "—", color: "#4ade80" },
          { label: "Avg (kcal/mol)", value: avgScore != null ? avgScore.toFixed(1) : "—",   color: "var(--text-primary)" },
          { label: "≥ 2 H-bonds",   value: hBondCount,                                      color: "#fbbf24" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg p-3" style={cardStyle}>
            <div className="font-mono text-xl font-semibold mb-0.5" style={{ color }}>
              {value}
            </div>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Two-column: table + viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 items-start">

        {/* Left: table + chart */}
        <div className="space-y-4 min-w-0">
          <div className="rounded-lg overflow-hidden" style={cardStyle}>
            <div
              className="px-4 py-3 border-b flex items-center justify-between gap-3"
              style={{ borderColor: "var(--border)" }}
            >
              <div>
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Binding affinity results
                </h3>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  Click a row to view its 3D pose
                </p>
              </div>
              <a
                href={getResultsCsvUrl(jobId)}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-3 py-1.5 rounded border no-underline font-medium transition-colors"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
              >
                Export CSV
              </a>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[560px]">
                <thead style={{ backgroundColor: "var(--bg-table-header)" }}>
                  <tr>
                    <SortTh label="Rank"    col="rank"       sort={sort} dir={dir} onClick={toggleSort} />
                    <SortTh label="Compound" col="name"      sort={sort} dir={dir} onClick={toggleSort} />
                    <SortTh label="Score"   col="score"      sort={sort} dir={dir} onClick={toggleSort} right />
                    <SortTh label="RMSD lo" col="rmsd_lower" sort={sort} dir={dir} onClick={toggleSort} right />
                    <SortTh label="RMSD hi" col="rmsd_upper" sort={sort} dir={dir} onClick={toggleSort} right />
                    <SortTh label="H-bonds" col="h_bonds"    sort={sort} dir={dir} onClick={toggleSort} right />
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                      Affinity
                    </th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                      Strength
                    </th>
                    <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                      Pose
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => {
                    const strength = scoreStrength(r.binding_score);
                    const s = STRENGTH_STYLE[strength];
                    const isSelected = r.id === selectedResultId;
                    return (
                      <tr
                        key={r.id}
                        className="border-b transition-colors"
                        style={{
                          borderColor: "var(--border)",
                          backgroundColor: isSelected
                            ? "rgba(20,184,166,0.08)"
                            : i % 2 === 0
                              ? "transparent"
                              : "var(--bg-card-inner)",
                          borderLeft: isSelected ? "2px solid #14b8a6" : "2px solid transparent",
                        }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "rgba(20,184,166,0.04)"; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = i % 2 === 0 ? "transparent" : "var(--bg-card-inner)"; }}
                      >
                        <td className="px-3 py-2 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          #{r.rank}
                        </td>
                        <td className="px-3 py-2 font-medium max-w-[160px]" title={r.compound_name}>
                          <span className="block truncate text-sm" style={{ color: "var(--text-primary)" }}>
                            {r.compound_name}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
                          {fmt(r.binding_score, 1)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {fmt(r.rmsd_lower, 2)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {fmt(r.rmsd_upper, 2)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
                          {r.h_bond_count ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <AffinityBar score={r.binding_score} />
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={{ backgroundColor: s.bg, color: s.color }}
                          >
                            {strength}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => setSelectedResultId((prev) => prev === r.id ? null : r.id)}
                            className="text-xs font-medium px-2 py-0.5 rounded cursor-pointer border-0 transition-colors"
                            style={{
                              backgroundColor: isSelected ? "rgba(20,184,166,0.15)" : "var(--bg-card-inner)",
                              color: isSelected ? "#14b8a6" : "var(--text-muted)",
                            }}
                          >
                            {isSelected ? "Viewing" : "View"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mini chart */}
            <div className="border-t px-4 pt-3 pb-4" style={{ borderColor: "var(--border)" }}>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
                Score distribution — click bar to select
              </p>
              <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
                <div style={{ height: chartHeight }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={chartData} margin={{ top: 2, right: 36, bottom: 2, left: 4 }}>
                      <XAxis
                        type="number"
                        domain={[0, "dataMax"]}
                        tick={{ fontSize: 9, fill: "var(--text-muted)" }}
                        tickFormatter={(v) => `-${v}`}
                        axisLine={{ stroke: "var(--border)" }}
                        tickLine={{ stroke: "var(--border)" }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={120}
                        tick={{ fontSize: 9, fill: "var(--text-secondary)" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="absScore" radius={[0, 3, 3, 0]} onClick={(d) => setSelectedResultId((prev) => prev === d.id ? null : d.id as string)} cursor="pointer">
                        {chartData.map((entry) => (
                          <Cell key={entry.id} fill={barFill(entry.rawScore, entry.id === selectedResultId)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: viewer (sticky) */}
        <div className="sticky top-[72px] space-y-3">
          {selectedResult ? (
            <CompoundInfo result={selectedResult} />
          ) : (
            <div
              className="rounded-lg p-4 text-center"
              style={cardStyle}
            >
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Click &ldquo;View&rdquo; on any row to inspect the docked conformation
              </p>
            </div>
          )}

          <div className="rounded-lg overflow-hidden" style={cardStyle}>
            <div
              className="px-3 py-2.5 border-b flex items-center justify-between gap-2 flex-wrap"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex gap-1">
                {(["cartoon", "surface", "stick"] as ViewMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setViewerMode(m)}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer border-0 transition-colors"
                    style={{
                      backgroundColor: viewerMode === m ? "rgba(20,184,166,0.15)" : "transparent",
                      color: viewerMode === m ? "#14b8a6" : "var(--text-muted)",
                    }}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>

              <button
                onClick={() => selectedResult && downloadPose(selectedResult)}
                disabled={!poseContent || !selectedResult}
                className="text-xs font-medium px-2.5 py-1 rounded border transition-colors"
                style={{
                  borderColor: "var(--border)",
                  color: poseContent && selectedResult ? "var(--text-secondary)" : "var(--text-muted)",
                  cursor: poseContent && selectedResult ? "pointer" : "not-allowed",
                  backgroundColor: "transparent",
                }}
              >
                Download pose
              </button>
            </div>

            <div className="p-2 relative">
              {poseLoading && (
                <div
                  className="absolute inset-2 flex items-center justify-center z-10 rounded"
                  style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
                >
                  <Spinner size="md" />
                </div>
              )}

              {selectedResultId ? (
                <ProteinViewer
                  pdbId={proteinCode || undefined}
                  pdbqtContent={poseContent ?? undefined}
                  height="340px"
                  mode={viewerMode}
                />
              ) : proteinCode ? (
                <ProteinViewer pdbId={proteinCode} height="340px" mode={viewerMode} />
              ) : (
                <div
                  className="flex flex-col items-center justify-center text-center"
                  style={{ height: 340 }}
                >
                  <p className="text-xs max-w-[180px]" style={{ color: "var(--text-muted)" }}>
                    Select a result to load its docked pose
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inner page ────────────────────────────────────────────────────────────────

function ResultsInner() {
  const router = useRouter();

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data, isLoading: jobsLoading } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => getJobs({ limit: 50 }),
    refetchInterval: 8000,
  });

  const jobs = data?.jobs ?? [];

  // Resolve protein code from sessionStorage map
  const jobProteinMap: Record<string, string> = useMemo(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(sessionStorage.getItem("pd_job_proteins") ?? "{}");
    } catch { return {}; }
  }, []);

  // Auto-select first job if none selected
  useEffect(() => {
    if (!selectedJobId && jobs.length > 0) {
      setSelectedJobId(jobs[0].id);
    }
  }, [jobs, selectedJobId]);

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;

  const cardStyle = {
    backgroundColor: "var(--bg-card)",
    border: "1px solid var(--border)",
  };

  // ── Empty state ────────────────────────────────────────────────────────────

  if (!jobsLoading && jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mb-4 text-xl"
          style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--border)" }}
        >
          📊
        </div>
        <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
          No docking jobs yet
        </h2>
        <p className="text-sm mb-6 max-w-sm" style={{ color: "var(--text-secondary)" }}>
          Run a docking job from the home page and results will appear here.
        </p>
        <button
          onClick={() => router.push("/")}
          className="px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer border-0"
          style={{ backgroundColor: "#14b8a6", color: "#000" }}
        >
          ← Start on home page
        </button>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 items-start">

        {/* Job list sidebar */}
        <div className="sticky top-[72px]">
          <div className="rounded-xl overflow-hidden" style={cardStyle}>
            <div
              className="px-4 py-3 border-b"
              style={{ borderColor: "var(--border)" }}
            >
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Docking Jobs
              </h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {jobs.length} total · select to view results
              </p>
            </div>

            <div className="p-2 space-y-1 max-h-[70vh] overflow-y-auto">
              {jobsLoading && (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="sm" />
                </div>
              )}
              {jobs.map((job) => (
                <JobListItem
                  key={job.id}
                  job={job}
                  active={job.id === selectedJobId}
                  proteinCode={jobProteinMap[job.id] ?? ""}
                  onClick={() => setSelectedJobId(job.id)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Results panel */}
        <div>
          {selectedJob ? (
            <ResultsPanel
              jobId={selectedJob.id}
              proteinCode={jobProteinMap[selectedJob.id] ?? ""}
            />
          ) : (
            <div
              className="rounded-xl flex items-center justify-center"
              style={{ ...cardStyle, height: 300 }}
            >
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Select a job to view its results
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page export ───────────────────────────────────────────────────────────────

export default function ResultsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Spinner size="lg" />
        </div>
      }
    >
      <ResultsInner />
    </Suspense>
  );
}
