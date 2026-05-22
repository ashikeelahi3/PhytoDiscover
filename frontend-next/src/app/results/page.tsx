"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getJob, getResults, getResultsCsvUrl, getPoseFile } from "@/lib/api";
import type { Result } from "@/lib/types";
import { Button } from "@/components/ui/Button";
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

const STRENGTH_CLS: Record<ScoreStrength, string> = {
  Strong: "bg-green-500/12 text-green-400",
  Moderate: "bg-amber-500/12 text-amber-400",
  Weak: "bg-[#64748b]/12 text-[#475569]",
  Unknown: "bg-[#64748b]/12 text-[#64748b]",
};

function AffinityBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-[#3a4560]">—</span>;
  const pct = Math.min(100, Math.max(0, (Math.abs(score) / 12) * 100));
  const color =
    score <= -9 ? "bg-green-400" : score <= -7 ? "bg-amber-400" : "bg-[#475569]";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-[#1e2433] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-[#94a3b8]">{fmt(score, 1)}</span>
    </div>
  );
}

// Bar colour: teal when selected, otherwise score-range colour
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

function SortTh({
  label,
  col,
  sort,
  dir,
  onClick,
  right,
}: {
  label: string;
  col: SortKey;
  sort: SortKey;
  dir: SortDir;
  onClick: (c: SortKey) => void;
  right?: boolean;
}) {
  const active = sort === col;
  return (
    <th
      className={`px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none hover:text-[#f1f5f9] transition-colors whitespace-nowrap ${
        right ? "text-right" : "text-left"
      } ${active ? "text-[#14b8a6]" : "text-[#64748b]"}`}
      onClick={() => onClick(col)}
    >
      {label}{" "}
      <span className="font-mono text-[9px]">
        {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
      </span>
    </th>
  );
}

// ── CompoundInfo sub-panel ────────────────────────────────────────────────────

function CompoundInfo({ result }: { result: Result & { rank: number } }) {
  const strength = scoreStrength(result.binding_score);
  return (
    <div className="bg-[#161b27] border border-[#1e2433] rounded-lg p-4 space-y-3">
      <div>
        <p className="text-[10px] font-semibold text-[#64748b] uppercase tracking-wider mb-1">
          Selected compound
        </p>
        <p
          className="text-sm font-semibold text-[#f1f5f9] leading-snug"
          title={result.compound_name}
        >
          {result.compound_name}
        </p>
        <p className="text-xs text-[#64748b] mt-0.5">Rank #{result.rank}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Binding score */}
        <div className="col-span-2 flex items-center justify-between bg-[#0f1117] border border-[#1e2433] rounded p-2.5">
          <span className="text-[10px] text-[#64748b] uppercase tracking-wide">
            Binding score
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-[#f1f5f9]">
              {fmt(result.binding_score, 1)} kcal/mol
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STRENGTH_CLS[strength]}`}
            >
              {strength}
            </span>
          </div>
        </div>

        {[
          { label: "RMSD lower", value: fmt(result.rmsd_lower, 2) },
          { label: "RMSD upper", value: fmt(result.rmsd_upper, 2) },
          { label: "H-bonds", value: result.h_bond_count ?? "—" },
          { label: "Pose file", value: result.pose_file ? "Available" : "None" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#0f1117] border border-[#1e2433] rounded p-2">
            <p className="text-[9px] text-[#64748b] uppercase tracking-wide mb-0.5">
              {label}
            </p>
            <p className="font-mono text-xs text-[#94a3b8]">{String(value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Custom tooltip for chart ──────────────────────────────────────────────────

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
    <div className="bg-[#161b27] border border-[#1e2433] rounded px-3 py-2 text-xs shadow-lg">
      <p className="text-[#f1f5f9] font-medium mb-0.5 max-w-[200px]">{d.name}</p>
      <p className="font-mono text-[#14b8a6]">
        {fmt(d.rawScore, 1)} kcal/mol
      </p>
    </div>
  );
}

// ── Inner page (reads searchParams) ──────────────────────────────────────────

function ResultsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job_id") ?? "";

  // ── Sort state ───────────────────────────────────────────────────────────────
  const [sort, setSort] = useState<SortKey>("rank");
  const [dir, setDir] = useState<SortDir>("asc");

  // ── Viewer state ─────────────────────────────────────────────────────────────
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [poseContent, setPoseContent] = useState<string | null>(null);
  const [poseLoading, setPoseLoading] = useState(false);
  const [viewerMode, setViewerMode] = useState<ViewMode>("cartoon");

  // Protein code persisted by the docking page at dispatch time.
  const [proteinCode] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("pd_last_protein") ?? "";
  });

  // ── Fetch PDBQT pose on row selection ────────────────────────────────────────
  useEffect(() => {
    if (!selectedResultId) {
      setPoseContent(null);
      return;
    }
    let cancelled = false;
    setPoseLoading(true);
    getPoseFile(selectedResultId)
      .then((text) => {
        if (!cancelled) setPoseContent(text);
      })
      .catch(() => {
        if (!cancelled) setPoseContent(null);
      })
      .finally(() => {
        if (!cancelled) setPoseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedResultId]);

  function selectResult(id: string) {
    setSelectedResultId((prev) => (prev === id ? null : id));
  }

  // ── Download pose as PDBQT file ───────────────────────────────────────────────
  function downloadPose(result: Result) {
    if (!poseContent) return;
    const safeName = result.compound_name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const score = result.binding_score != null ? Math.abs(result.binding_score).toFixed(1) : "unk";
    const fileName = `${safeName}_${proteinCode || "protein"}_${score}.pdbqt`;
    const blob = new Blob([poseContent], { type: "chemical/x-pdbqt" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: job, isLoading: jobLoading } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "done" || s === "failed" ? false : 5000;
    },
  });

  const { data: results, isLoading: resultsLoading } = useQuery({
    queryKey: ["results", jobId],
    queryFn: () => getResults(jobId),
    enabled: job?.status === "done",
  });

  function toggleSort(col: SortKey) {
    if (sort === col) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(col);
      setDir("asc");
    }
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  // Stable rank order: sort by binding_score ascending (most negative = best = rank 1)
  const ranked = useMemo<(Result & { rank: number })[]>(() => {
    if (!results) return [];
    return [...results]
      .sort((a, b) => (a.binding_score ?? 0) - (b.binding_score ?? 0))
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [results]);

  // User-controlled sort for the table display
  const sorted = useMemo(() => {
    return [...ranked].sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sort) {
        case "rank":       av = a.rank;                              bv = b.rank;                              break;
        case "name":       av = a.compound_name.toLowerCase();       bv = b.compound_name.toLowerCase();       break;
        case "score":      av = a.binding_score ?? 0;                bv = b.binding_score ?? 0;                break;
        case "rmsd_lower": av = a.rmsd_lower ?? 0;                   bv = b.rmsd_lower ?? 0;                   break;
        case "rmsd_upper": av = a.rmsd_upper ?? 0;                   bv = b.rmsd_upper ?? 0;                   break;
        case "h_bonds":    av = a.h_bond_count ?? 0;                 bv = b.h_bond_count ?? 0;                 break;
        default:           av = a.rank;                              bv = b.rank;
      }
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [ranked, sort, dir]);

  // Chart data: ranked order (best first), use absolute scores for bar width
  const chartData = useMemo(
    () =>
      ranked.map((r) => ({
        id: r.id,
        name:
          r.compound_name.length > 20
            ? r.compound_name.slice(0, 19) + "…"
            : r.compound_name,
        absScore: Math.abs(r.binding_score ?? 0),
        rawScore: r.binding_score,
      })),
    [ranked]
  );

  const bestScore = ranked.length > 0 ? ranked[0].binding_score : null;
  const avgScore =
    ranked.length > 0
      ? ranked.reduce((s, r) => s + (r.binding_score ?? 0), 0) / ranked.length
      : null;
  const hBondCount = ranked.filter((r) => (r.h_bond_count ?? 0) >= 2).length;

  const selectedResult = ranked.find((r) => r.id === selectedResultId) ?? null;

  // Chart height: 26 px per bar, min 100
  const chartHeight = Math.max(100, ranked.length * 26);

  // ── Early return states ───────────────────────────────────────────────────────

  if (!jobId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-5xl mb-4">📊</div>
        <h2 className="text-xl font-semibold mb-2">No job selected</h2>
        <p className="text-[#64748b] text-sm mb-6 max-w-sm">
          Run a docking job first and then return here to view binding affinities.
        </p>
        <Button onClick={() => router.push("/docking")}>← Go to docking setup</Button>
      </div>
    );
  }

  if (jobLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (job?.status === "failed") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-5xl mb-4">❌</div>
        <h2 className="text-xl font-semibold mb-2 text-red-400">Job failed</h2>
        {job.error_message && (
          <p className="text-[#64748b] text-xs font-mono mb-6 max-w-lg break-all">
            {job.error_message}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => router.push(`/queue?job_id=${jobId}`)}>
            View job details
          </Button>
          <Button onClick={() => router.push("/docking")}>Try again →</Button>
        </div>
      </div>
    );
  }

  if (job && job.status !== "done") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Spinner size="lg" />
        <h2 className="text-lg font-semibold mt-6 mb-2">Docking in progress</h2>
        <div className="mb-4">
          <StatusBadge status={job.status} />
        </div>
        <p className="text-[#64748b] text-sm mb-6">
          Results will appear here when the job completes.
        </p>
        <Button onClick={() => router.push(`/queue?job_id=${jobId}`)}>
          Watch progress →
        </Button>
      </div>
    );
  }

  if (resultsLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!results || results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-5xl mb-4">🔍</div>
        <h2 className="text-xl font-semibold mb-2">No results found</h2>
        <p className="text-[#64748b] text-sm mb-6">
          The job completed but returned no binding scores.
        </p>
        <Button onClick={() => router.push("/docking")}>← Run a new docking job</Button>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  return (
    <div className="pb-20 space-y-5">
      {/* ── Stats cards (full width) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total results",      value: ranked.length,                              color: "text-[#14b8a6]" },
          { label: "Best (kcal/mol)",    value: bestScore != null ? bestScore.toFixed(1) : "—", color: "text-green-400" },
          { label: "Avg (kcal/mol)",     value: avgScore  != null ? avgScore.toFixed(1)  : "—", color: "text-[#f1f5f9]" },
          { label: "≥ 2 H-bonds",        value: hBondCount,                                 color: "text-amber-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-[#161b27] border border-[#1e2433] rounded-lg p-4">
            <div className={`font-mono text-2xl font-medium mb-1 ${color}`}>{value}</div>
            <div className="text-xs text-[#64748b] uppercase tracking-wider">{label}</div>
          </div>
        ))}
      </div>

      {/* ── Two-column content ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-5 items-start">

        {/* ════ LEFT COLUMN: Table + Chart ════ */}
        <div className="min-w-0 space-y-4">

          {/* Table card */}
          <div className="bg-[#161b27] border border-[#1e2433] rounded-lg overflow-hidden">
            {/* Table header */}
            <div className="px-4 py-3 border-b border-[#1e2433] flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-[#f1f5f9]">
                  Binding affinity results
                </h3>
                <p className="text-xs text-[#64748b] mt-0.5">
                  Job{" "}
                  <span className="font-mono text-[#94a3b8]">{jobId.slice(0, 8)}…</span>
                  {" · "}click a row to view its 3D pose
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.open(getResultsCsvUrl(jobId), "_blank")}
              >
                Export CSV
              </Button>
            </div>

            {/* Scrollable table */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[620px]">
                <thead className="bg-[#141927] border-b border-[#1e2433]">
                  <tr>
                    <SortTh label="Rank"       col="rank"       sort={sort} dir={dir} onClick={toggleSort} />
                    <SortTh label="Compound"   col="name"       sort={sort} dir={dir} onClick={toggleSort} />
                    <SortTh label="Score"      col="score"      sort={sort} dir={dir} onClick={toggleSort} right />
                    <SortTh label="RMSD lo"    col="rmsd_lower" sort={sort} dir={dir} onClick={toggleSort} right />
                    <SortTh label="RMSD hi"    col="rmsd_upper" sort={sort} dir={dir} onClick={toggleSort} right />
                    <SortTh label="H-bonds"    col="h_bonds"    sort={sort} dir={dir} onClick={toggleSort} right />
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-[#64748b] uppercase tracking-wider">
                      Affinity
                    </th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-[#64748b] uppercase tracking-wider">
                      Strength
                    </th>
                    <th className="px-3 py-2.5 text-center text-[10px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">
                      Pose
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => {
                    const strength = scoreStrength(r.binding_score);
                    const isSelected = r.id === selectedResultId;
                    const rowBg = isSelected
                      ? "bg-[#14b8a6]/10 border-l-2 border-l-[#14b8a6]"
                      : i % 2 === 0
                        ? "bg-[#161b27]"
                        : "bg-[#131820]";
                    return (
                      <tr
                        key={r.id}
                        className={`border-b border-[#1e2433] last:border-b-0 transition-colors hover:bg-[#14b8a6]/5 ${rowBg}`}
                      >
                        <td className="px-3 py-2 font-mono text-xs text-[#64748b]">
                          #{r.rank}
                        </td>
                        <td
                          className="px-3 py-2 font-medium text-[#f1f5f9] max-w-[180px]"
                          title={r.compound_name}
                        >
                          <span className="block truncate text-sm">
                            {r.compound_name}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-sm text-[#94a3b8]">
                          {fmt(r.binding_score, 1)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-[#64748b]">
                          {fmt(r.rmsd_lower, 2)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-[#64748b]">
                          {fmt(r.rmsd_upper, 2)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-[#94a3b8]">
                          {r.h_bond_count ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <AffinityBar score={r.binding_score} />
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STRENGTH_CLS[strength]}`}
                          >
                            {strength}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => selectResult(r.id)}
                            className={`text-xs font-medium px-2 py-0.5 rounded cursor-pointer border-0 transition-colors ${
                              isSelected
                                ? "bg-[#14b8a6]/15 text-[#14b8a6]"
                                : "bg-[#1e2433] text-[#64748b] hover:text-[#f1f5f9]"
                            }`}
                          >
                            {isSelected ? "Viewing" : "View pose"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Mini score chart ── */}
            <div className="border-t border-[#1e2433] px-4 pt-3 pb-4">
              <p className="text-[10px] font-semibold text-[#64748b] uppercase tracking-wider mb-2">
                Score distribution — click a bar to select compound
              </p>
              <div
                className="overflow-y-auto"
                style={{ maxHeight: 280 }}
              >
                {/* Explicit height so ResponsiveContainer measures width only */}
                <div style={{ height: chartHeight }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={chartData}
                      margin={{ top: 2, right: 36, bottom: 2, left: 4 }}
                    >
                      <XAxis
                        type="number"
                        domain={[0, "dataMax"]}
                        tick={{ fontSize: 9, fill: "#64748b" }}
                        tickFormatter={(v) => `-${v}`}
                        axisLine={{ stroke: "#1e2433" }}
                        tickLine={{ stroke: "#1e2433" }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={130}
                        tick={{ fontSize: 9, fill: "#94a3b8" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar
                        dataKey="absScore"
                        radius={[0, 3, 3, 0]}
                        onClick={(data) => selectResult(data.id as string)}
                        cursor="pointer"
                      >
                        {chartData.map((entry) => (
                          <Cell
                            key={entry.id}
                            fill={barFill(entry.rawScore, entry.id === selectedResultId)}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ════ RIGHT COLUMN: Pose viewer (sticky) ════ */}
        <div className="sticky top-4 space-y-3">

          {/* Compound info — shown when a row is selected */}
          {selectedResult ? (
            <CompoundInfo result={selectedResult} />
          ) : (
            <div className="bg-[#161b27] border border-[#1e2433] rounded-lg p-4 text-center">
              <p className="text-xs text-[#3a4560]">
                Click "View pose" on any result row to inspect the docked conformation
              </p>
            </div>
          )}

          {/* Viewer card */}
          <div className="bg-[#161b27] border border-[#1e2433] rounded-lg overflow-hidden">
            {/* Viewer toolbar */}
            <div className="px-3 py-2.5 border-b border-[#1e2433] flex items-center justify-between gap-2 flex-wrap">
              <div className="flex gap-1">
                {(["cartoon", "surface", "stick"] as ViewMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setViewerMode(m)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer border-0 transition-colors ${
                      viewerMode === m
                        ? "bg-[#14b8a6]/15 text-[#14b8a6]"
                        : "bg-transparent text-[#64748b] hover:text-[#f1f5f9]"
                    }`}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>

              <button
                onClick={() => selectedResult && downloadPose(selectedResult)}
                disabled={!poseContent || !selectedResult}
                className={`text-xs font-medium px-2.5 py-1 rounded border transition-colors ${
                  poseContent && selectedResult
                    ? "border-[#1e2433] text-[#64748b] hover:text-[#f1f5f9] hover:border-[#2a3145] cursor-pointer"
                    : "border-[#1e2433] text-[#3a4560] cursor-not-allowed"
                } bg-transparent`}
              >
                Download pose
              </button>
            </div>

            {/* 3-D viewer */}
            <div className="p-2 relative">
              {poseLoading && (
                <div className="absolute inset-2 flex items-center justify-center bg-[#0f1117]/75 z-10 rounded">
                  <Spinner size="md" />
                </div>
              )}

              {selectedResultId ? (
                <ProteinViewer
                  pdbId={proteinCode || undefined}
                  pdbqtContent={poseContent ?? undefined}
                  height="360px"
                  mode={viewerMode}
                />
              ) : (
                // Protein-only preview while no compound is selected
                proteinCode ? (
                  <ProteinViewer
                    pdbId={proteinCode}
                    height="360px"
                    mode={viewerMode}
                  />
                ) : (
                  <div
                    className="flex flex-col items-center justify-center text-center"
                    style={{ height: "360px" }}
                  >
                    <div className="text-4xl mb-3 opacity-10">🔬</div>
                    <p className="text-xs text-[#3a4560] max-w-[180px]">
                      Select a result to load its docked pose
                    </p>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Fixed bottom bar ── */}
      <div className="fixed bottom-0 left-[220px] right-0 h-16 bg-[#161b27]/95 backdrop-blur border-t border-[#1e2433] flex items-center justify-between px-8 z-20">
        <div className="text-sm text-[#64748b]">
          <strong className="text-[#14b8a6] font-mono">{ranked.length}</strong>{" "}
          result{ranked.length !== 1 ? "s" : ""}
          {bestScore != null && (
            <>
              {" · "}best{" "}
              <strong className="text-green-400 font-mono">
                {bestScore.toFixed(1)}
              </strong>{" "}
              kcal/mol
            </>
          )}
          {selectedResult && (
            <span className="ml-3 text-[#14b8a6]">
              Viewing: {selectedResult.compound_name.slice(0, 30)}
              {selectedResult.compound_name.length > 30 ? "…" : ""}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="md"
            onClick={() => router.push(`/queue?job_id=${jobId}`)}
          >
            ← Job details
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => window.open(getResultsCsvUrl(jobId), "_blank")}
          >
            Download CSV
          </Button>
          <Button variant="primary" size="md" onClick={() => router.push("/")}>
            New search →
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Page export (Suspense boundary for useSearchParams) ───────────────────────

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
