"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { getJob, getJobs, getWorkers } from "@/lib/api";
import type { DockingJob, JobStatus } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { StatusBadge } from "@/components/ui/Badge";

// ── Progress map ──────────────────────────────────────────────────────────────

const PROGRESS: Record<JobStatus, number> = {
  pending: 5,
  preparing: 25,
  docking: 60,
  parsing: 85,
  done: 100,
  failed: 0,
};

const STEPS: { status: JobStatus; label: string; description: string }[] = [
  { status: "pending", label: "Queued", description: "Waiting for a worker" },
  { status: "preparing", label: "Preparing", description: "Converting protein & ligands to PDBQT" },
  { status: "docking", label: "Docking", description: "AutoDock Vina running" },
  { status: "parsing", label: "Parsing", description: "Extracting binding scores" },
  { status: "done", label: "Complete", description: "Results ready" },
];

const STATUS_ORDER: JobStatus[] = ["pending", "preparing", "docking", "parsing", "done"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepIndex(s: JobStatus) {
  return STATUS_ORDER.indexOf(s);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Inner page (reads searchParams) ──────────────────────────────────────────

function QueueInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job_id") ?? "";

  // WebSocket state
  const [wsState, setWsState] = useState<"connecting" | "connected" | "disconnected" | "failed">(
    "connecting"
  );
  const [logs, setLogs] = useState<{ ts: number; text: string }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Focused job
  const { data: focusedJob, refetch: refetchFocused } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJob(jobId),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "done" || s === "failed" ? false : 5000;
    },
  });

  // Jobs list
  const [jobsPage, setJobsPage] = useState(1);
  const PAGE_SIZE = 10;
  const { data: jobsData } = useQuery({
    queryKey: ["jobs", jobsPage],
    queryFn: () => getJobs({ skip: (jobsPage - 1) * PAGE_SIZE, limit: PAGE_SIZE }),
    refetchInterval: 30_000,
  });

  // Workers
  const { data: workers } = useQuery({
    queryKey: ["workers"],
    queryFn: getWorkers,
    refetchInterval: 30_000,
  });

  // WebSocket
  useEffect(() => {
    if (!jobId) return;
    const ws = new WebSocket(`ws://localhost:8000/ws/jobs/${jobId}`);
    wsRef.current = ws;
    setWsState("connecting");

    ws.onopen = () => setWsState("connected");
    ws.onclose = () => setWsState("disconnected");
    ws.onerror = () => setWsState("failed");
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { status?: string; message?: string };
        const text = msg.message ?? JSON.stringify(msg);
        setLogs((prev) => [{ ts: Date.now(), text }, ...prev].slice(0, 60));
        if (msg.status) refetchFocused();
      } catch {
        setLogs((prev) => [{ ts: Date.now(), text: e.data }, ...prev].slice(0, 60));
      }
    };

    return () => ws.close();
  }, [jobId, refetchFocused]);

  // Scroll log to top when new entries arrive
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const job = focusedJob;
  const status = job?.status ?? "pending";
  const progress = PROGRESS[status];
  const currentStepIdx = stepIndex(status === "failed" ? "pending" : status);
  const totalJobs = jobsData?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalJobs / PAGE_SIZE));

  // ── No job ID ──────────────────────────────────────────────────────────────

  if (!jobId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-5xl mb-4">📋</div>
        <h2 className="text-xl font-semibold mb-2">No job selected</h2>
        <p className="text-[#64748b] text-sm mb-6 max-w-sm">
          Dispatch a docking job from Step 3 first.
        </p>
        <Button onClick={() => router.push("/docking")}>← Go to docking setup</Button>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="pb-20 space-y-6">
      {/* Progress card */}
      <div className="bg-[#161b27] border border-[#1e2433] rounded-lg p-6">
        <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-base font-semibold text-[#f1f5f9]">
                Job&nbsp;
                <span className="font-mono text-[#14b8a6] text-sm">{jobId.slice(0, 8)}…</span>
              </h2>
              {job && <StatusBadge status={job.status} />}
            </div>
            {job && (
              <div className="text-xs text-[#64748b]">
                Dispatched {fmtDate(job.created_at)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                wsState === "connected"
                  ? "bg-green-400"
                  : wsState === "connecting"
                    ? "bg-yellow-400 animate-pulse"
                    : "bg-[#3a4560]"
              }`}
            />
            <span className="text-[#64748b]">
              {wsState === "connected"
                ? "Live updates on"
                : wsState === "connecting"
                  ? "Connecting…"
                  : wsState === "failed"
                    ? "Live updates unavailable"
                    : "Disconnected"}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-[#64748b] mb-1.5">
            <span>{status === "failed" ? "Job failed" : `${progress}% complete`}</span>
            <span className="font-mono">{progress}%</span>
          </div>
          <div className="h-2 bg-[#1e2433] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                status === "failed"
                  ? "bg-red-500"
                  : status === "done"
                    ? "bg-green-400"
                    : "bg-[#14b8a6]"
              }`}
              style={{ width: `${status === "failed" ? 100 : progress}%` }}
            />
          </div>
        </div>

        {/* Timeline steps */}
        <div className="flex gap-0 overflow-x-auto pb-1">
          {STEPS.map((step, i) => {
            const isActive = step.status === status;
            const isDone = !["failed"].includes(status) && i < currentStepIdx;
            const isFailed = status === "failed";

            return (
              <div key={step.status} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center flex-1 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold shrink-0 ${
                      isFailed && i === 0
                        ? "border-red-500 bg-red-500/20 text-red-400"
                        : isDone
                          ? "border-green-400 bg-green-400/20 text-green-400"
                          : isActive && !isFailed
                            ? "border-[#14b8a6] bg-[#14b8a6]/20 text-[#14b8a6] animate-pulse"
                            : "border-[#2a3145] bg-transparent text-[#3a4560]"
                    }`}
                  >
                    {isDone ? "✓" : i + 1}
                  </div>
                  <div className="mt-1.5 text-center px-1 hidden sm:block">
                    <div
                      className={`text-xs font-medium ${
                        isActive && !isFailed ? "text-[#14b8a6]" : isDone ? "text-green-400" : "text-[#64748b]"
                      }`}
                    >
                      {step.label}
                    </div>
                    <div className="text-[10px] text-[#3a4560] leading-tight mt-0.5 max-w-[90px] mx-auto">
                      {step.description}
                    </div>
                  </div>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 mx-1 shrink-0 ${
                      i < currentStepIdx && !isFailed ? "bg-green-400/40" : "bg-[#1e2433]"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Error / done actions */}
        {status === "failed" && job?.error_message && (
          <div className="mt-4 bg-red-500/8 border border-red-500/20 rounded p-3">
            <div className="text-xs font-semibold text-red-400 mb-1">Error</div>
            <div className="font-mono text-xs text-red-300 whitespace-pre-wrap break-all">
              {job.error_message}
            </div>
          </div>
        )}
        {status === "done" && (
          <div className="mt-4 flex items-center gap-3">
            <div className="text-sm text-green-400 font-medium">Docking complete!</div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => router.push(`/results?job_id=${jobId}`)}
            >
              View results →
            </Button>
          </div>
        )}
      </div>

      {/* Live log */}
      <div className="bg-[#161b27] border border-[#1e2433] rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#1e2433] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#f1f5f9]">Live log</h3>
          <span className="text-xs text-[#64748b]">{logs.length} entries</span>
        </div>
        <div className="h-44 overflow-y-auto font-mono text-xs p-3 space-y-1 flex flex-col-reverse">
          <div ref={logsEndRef} />
          {logs.length === 0 ? (
            <div className="text-[#3a4560] italic">Waiting for events…</div>
          ) : (
            logs.map((l) => (
              <div key={l.ts} className="flex gap-2 text-[#64748b]">
                <span className="shrink-0 text-[#3a4560]">
                  {new Date(l.ts).toLocaleTimeString()}
                </span>
                <span className="text-[#94a3b8] break-all">{l.text}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Jobs table + workers side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Jobs table */}
        <div className="lg:col-span-2 bg-[#161b27] border border-[#1e2433] rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#1e2433] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#f1f5f9]">Your jobs</h3>
            <span className="text-xs text-[#64748b]">{totalJobs} total</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[480px]">
              <thead className="bg-[#141927] border-b border-[#1e2433]">
                <tr>
                  {["Job ID", "Status", "Created", ""].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2.5 text-left text-[10px] font-semibold text-[#64748b] uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!jobsData ? (
                  <tr>
                    <td colSpan={4} className="text-center py-8">
                      <Spinner size="sm" />
                    </td>
                  </tr>
                ) : jobsData.jobs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-8 text-[#64748b] text-sm">
                      No jobs yet.
                    </td>
                  </tr>
                ) : (
                  jobsData.jobs.map((j, i) => (
                    <tr
                      key={j.id}
                      className={`border-b border-[#1e2433] last:border-b-0 ${
                        j.id === jobId
                          ? "bg-[#14b8a6]/8"
                          : i % 2 === 0
                            ? "bg-[#161b27]"
                            : "bg-[#131820]"
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-[#94a3b8]">
                        {j.id.slice(0, 8)}…
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={j.status} />
                      </td>
                      <td className="px-3 py-2 text-xs text-[#64748b]">{fmtDate(j.created_at)}</td>
                      <td className="px-3 py-2 text-right">
                        {j.status === "done" ? (
                          <button
                            onClick={() => router.push(`/results?job_id=${j.id}`)}
                            className="text-xs text-[#14b8a6] hover:underline cursor-pointer bg-transparent border-none"
                          >
                            Results →
                          </button>
                        ) : j.id !== jobId ? (
                          <button
                            onClick={() => router.push(`/queue?job_id=${j.id}`)}
                            className="text-xs text-[#64748b] hover:text-[#94a3b8] cursor-pointer bg-transparent border-none"
                          >
                            Watch →
                          </button>
                        ) : (
                          <span className="text-xs text-[#14b8a6]">← Current</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="px-4 py-2.5 border-t border-[#1e2433] flex items-center justify-between">
              <span className="text-xs text-[#64748b]">
                Page {jobsPage} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={jobsPage === 1}
                  onClick={() => setJobsPage((p) => Math.max(1, p - 1))}
                >
                  ← Prev
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={jobsPage >= totalPages}
                  onClick={() => setJobsPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next →
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Worker panel */}
        <div className="bg-[#161b27] border border-[#1e2433] rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#1e2433]">
            <h3 className="text-sm font-semibold text-[#f1f5f9]">Workers</h3>
          </div>
          <div className="p-4 space-y-3">
            {!workers ? (
              <div className="flex justify-center py-4">
                <Spinner size="sm" />
              </div>
            ) : workers.error ? (
              <div className="text-xs text-[#64748b]">Worker data unavailable</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {[
                    { label: "Online", value: workers.total_online, color: "text-green-400" },
                    {
                      label: "Docking queue",
                      value: workers.docking_queue_length,
                      color: "text-[#14b8a6]",
                    },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-[#131820] rounded p-2.5 text-center">
                      <div className={`font-mono text-xl font-medium ${color}`}>{value}</div>
                      <div className="text-[10px] text-[#64748b] mt-0.5">{label}</div>
                    </div>
                  ))}
                </div>
                {workers.workers.length === 0 ? (
                  <div className="text-xs text-[#64748b]">No workers registered.</div>
                ) : (
                  workers.workers.map((w) => (
                    <div
                      key={w.name}
                      className="flex items-center justify-between py-1.5 border-b border-[#1e2433] last:border-b-0"
                    >
                      <div>
                        <div className="text-xs font-medium text-[#f1f5f9] truncate max-w-[130px]">
                          {w.name}
                        </div>
                        <div className="text-[10px] text-[#64748b]">
                          {w.active_tasks} active · {w.queue}
                        </div>
                      </div>
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          w.status === "online" ? "bg-green-400" : "bg-[#3a4560]"
                        }`}
                      />
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page export (Suspense boundary for useSearchParams) ───────────────────────

export default function QueuePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Spinner size="lg" />
        </div>
      }
    >
      <QueueInner />
    </Suspense>
  );
}
