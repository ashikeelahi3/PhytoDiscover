"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getProtein, getChains, computeGridBox, dispatchJob } from "@/lib/api";
import { useCompoundSelection } from "@/contexts/CompoundSelectionContext";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { ProteinViewer } from "@/components/ProteinViewer";
import type { GridMode } from "@/lib/types";

type ViewerMode = "cartoon" | "surface" | "stick";

const PRESETS = ["6LU7", "1HVR", "3HTB"];

export default function DockingPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { selected } = useCompoundSelection();

  // ── Protein state ────────────────────────────────────────────────────────────
  const [proteinInput, setProteinInput] = useState("");
  const [proteinCode, setProteinCode] = useState("");
  const [proteinMeta, setProteinMeta] = useState<Record<string, unknown> | null>(null);
  const [chains, setChains] = useState<string[]>([]);
  const [selectedChain, setSelectedChain] = useState("");
  const [fetchingProtein, setFetchingProtein] = useState(false);
  const [proteinError, setProteinError] = useState("");

  // ── Viewer state ─────────────────────────────────────────────────────────────
  const [viewerMode, setViewerMode] = useState<ViewerMode>("cartoon");

  // ── Grid state ───────────────────────────────────────────────────────────────
  const [gridMode, setGridMode] = useState<GridMode>("blind");
  const [coordX, setCoordX] = useState("");
  const [coordY, setCoordY] = useState("");
  const [coordZ, setCoordZ] = useState("");
  const [radius, setRadius] = useState("");
  const [gridParams, setGridParams] = useState<Record<string, number> | null>(null);
  const [gridError, setGridError] = useState("");
  const [computingGrid, setComputingGrid] = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const proteinLoaded = !!proteinCode;
  const chainSelected = !!selectedChain;
  const gridReady = !!gridParams;
  const canDispatch = proteinLoaded && chainSelected && gridReady && selected.length > 0;

  // Memoised so the viewer only reloads when the actual values change, not on
  // every parent render (gridBox is compared by reference inside the effect).
  const gridBox = useMemo(
    () =>
      gridParams
        ? {
            center: {
              x: gridParams.center_x,
              y: gridParams.center_y,
              z: gridParams.center_z,
            },
            size: {
              x: gridParams.size_x,
              y: gridParams.size_y,
              z: gridParams.size_z,
            },
          }
        : undefined,
    [gridParams]
  );

  // ── Fetch protein ─────────────────────────────────────────────────────────────
  async function fetchProtein(code?: string) {
    const c = (code || proteinInput).trim().toUpperCase();
    if (!c) return;
    setFetchingProtein(true);
    setProteinError("");
    setChains([]);
    setSelectedChain("");
    setGridParams(null);
    setGridError("");
    if (code) setProteinInput(c);

    try {
      const [protein, chainsData] = await Promise.all([
        getProtein(c),
        getChains(c),
      ]);
      setProteinCode(protein.protein_code);
      setProteinMeta(protein.metadata_json ?? {});
      setChains(chainsData.chains);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setProteinError(`Could not fetch protein: ${msg}`);
      setProteinCode("");
    } finally {
      setFetchingProtein(false);
    }
  }

  function selectChain(chain: string) {
    setSelectedChain(chain);
    setGridParams(null);
    setGridError("");
  }

  // ── Compute grid ──────────────────────────────────────────────────────────────
  async function handleComputeGrid() {
    if (!proteinCode || !selectedChain) return;
    setComputingGrid(true);
    setGridError("");
    try {
      const body: Parameters<typeof computeGridBox>[0] = {
        protein_code: proteinCode,
        chain: selectedChain,
        mode: gridMode,
      };
      if (gridMode === "active_site") {
        const x = parseFloat(coordX);
        const y = parseFloat(coordY);
        const z = parseFloat(coordZ);
        const r = parseFloat(radius);
        if ([x, y, z, r].some(isNaN)) {
          setGridError("Enter all four coordinates (X, Y, Z, Radius).");
          setComputingGrid(false);
          return;
        }
        body.x_coord = x;
        body.y_coord = y;
        body.z_coord = z;
        body.radius = r;
      }
      const result = await computeGridBox(body);
      setGridParams(result.grid_params);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setGridError(`Grid computation failed: ${msg}`);
    } finally {
      setComputingGrid(false);
    }
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────────
  const dispatchMutation = useMutation({
    mutationFn: () =>
      dispatchJob({
        protein_code: proteinCode,
        chain: selectedChain,
        compound_ids: selected.map((c) => c.id),
        smiles_list: [],
        plant_name: null,
        grid_mode: gridMode,
        grid_params: gridParams!,
      }),
    onSuccess: (data) => {
      // Store so the results page can load the protein 3D structure.
      sessionStorage.setItem("pd_last_protein", proteinCode);
      showToast(
        `Docking job started for ${selected.length} compound${selected.length !== 1 ? "s" : ""} against ${proteinCode}`,
        "success"
      );
      setTimeout(() => router.push(`/queue?job_id=${data.job_id}`), 700);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Unknown error";
      showToast(`Launch failed: ${msg}`, "error");
    },
  });

  // ── Render ────────────────────────────────────────────────────────────────────

  if (selected.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-5xl mb-4">⚗️</div>
        <h2 className="text-xl font-semibold mb-2">No validated compounds</h2>
        <p className="text-[#64748b] text-sm mb-6 max-w-sm">
          Complete Steps 1 and 2 first — search for compounds and validate their SMILES.
        </p>
        <Button onClick={() => router.push("/smiles")}>← Go to Prepare molecules</Button>
      </div>
    );
  }

  const meta = proteinMeta as Record<string, unknown> | null;

  return (
    <div className="pb-4">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        {/* Left column */}
        <div className="flex flex-col gap-5">

          {/* ── Step 1: Protein ────────────────────────────────────────────── */}
          <Card
            title="1 — Protein target"
            subtitle="Enter a PDB ID (4 chars) or AlphaFold accession"
            badge={proteinLoaded ? { label: "✓ Loaded", cls: "bg-green-500/12 text-green-400" } : { label: "Incomplete", cls: "bg-[#1e2433] text-[#64748b]" }}
          >
            {/* Input row */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={proteinInput}
                onChange={(e) => setProteinInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && fetchProtein()}
                placeholder="e.g. 1ABC or AF-P12345-F1"
                maxLength={40}
                spellCheck={false}
                autoComplete="off"
                className="flex-1 bg-[#0f1117] border border-[#1e2433] text-[#f1f5f9] placeholder-[#3a4560] rounded-md px-3 py-2 text-sm font-mono outline-none focus:border-[#14b8a6] transition-colors uppercase"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => fetchProtein()}
                disabled={fetchingProtein || !proteinInput.trim()}
              >
                {fetchingProtein ? <Spinner size="sm" /> : "Fetch"}
              </Button>
            </div>

            {/* Presets */}
            <div className="flex gap-2 mb-3">
              <span className="text-xs text-[#64748b] self-center">Quick load:</span>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => fetchProtein(p)}
                  className="px-3 py-1 rounded border border-[#1e2433] text-xs font-mono text-[#64748b] hover:border-[#14b8a6] hover:text-[#14b8a6] cursor-pointer bg-transparent transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>

            {proteinError && (
              <p className="text-red-400 text-xs mb-3">{proteinError}</p>
            )}

            {/* Protein info */}
            {proteinLoaded && meta && (
              <div className="bg-[#0f1117] border border-[#1e2433] rounded-lg p-3 mb-3">
                <p className="text-sm font-semibold text-[#f1f5f9] mb-2">
                  {(meta.title as string) || proteinCode}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["Organism", meta.organism as string],
                    ["Method", meta.method as string],
                    ["Resolution", meta.resolution ? `${meta.resolution} Å` : "—"],
                    ["Chains", (meta.chains as string[] | undefined)?.join(", ") || "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[10px] text-[#64748b] uppercase tracking-wide">{k}</div>
                      <div className="font-mono text-sm text-[#f1f5f9]">{v || "—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chain buttons */}
            {chains.length > 0 && (
              <div>
                <label className="block text-[10px] font-semibold text-[#64748b] uppercase tracking-wider mb-2">
                  Chain
                </label>
                <div className="flex flex-wrap gap-2 mb-1">
                  {chains.map((ch) => (
                    <button
                      key={ch}
                      onClick={() => selectChain(ch)}
                      className={`px-3 py-1.5 rounded border font-mono text-sm font-semibold cursor-pointer transition-colors ${
                        selectedChain === ch
                          ? "bg-[#14b8a6]/12 border-[#14b8a6] text-[#14b8a6]"
                          : "bg-[#0f1117] border-[#1e2433] text-[#64748b] hover:border-[#14b8a6] hover:text-[#f1f5f9]"
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
                {!selectedChain && (
                  <p className="text-xs text-[#64748b]">Select a chain to continue</p>
                )}
              </div>
            )}
          </Card>

          {/* ── Protein viewer ─────────────────────────────────────────────── */}
          {proteinLoaded && (
            <div className="bg-[#161b27] border border-[#1e2433] rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#1e2433] flex items-center justify-between">
                <span className="text-xs font-semibold text-[#64748b] uppercase tracking-wider">
                  {selectedChain
                    ? `${proteinCode} · Chain ${selectedChain}${gridBox ? " · Box overlay" : ""}`
                    : proteinCode}
                </span>
                <div className="flex gap-1">
                  {(["cartoon", "surface", "stick"] as ViewerMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setViewerMode(m)}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer border-0 transition-colors ${
                        viewerMode === m
                          ? "bg-[#14b8a6]/15 text-[#14b8a6]"
                          : "bg-transparent text-[#64748b] hover:text-[#f1f5f9]"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-2">
                <ProteinViewer
                  pdbId={proteinCode}
                  selectedChain={selectedChain || undefined}
                  gridBox={gridBox}
                  height="300px"
                  mode={viewerMode}
                />
              </div>
            </div>
          )}

          {/* ── Step 2: Grid box ───────────────────────────────────────────── */}
          <Card
            title="2 — Search grid"
            subtitle="Define the docking search space"
            badge={gridReady ? { label: "✓ Computed", cls: "bg-green-500/12 text-green-400" } : { label: "Incomplete", cls: "bg-[#1e2433] text-[#64748b]" }}
          >
            {/* Mode toggle */}
            <div className="mb-4">
              <label className="block text-[10px] font-semibold text-[#64748b] uppercase tracking-wider mb-2">
                Grid mode
              </label>
              <div className="flex border border-[#1e2433] rounded-lg overflow-hidden">
                {(["blind", "active_site"] as GridMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => { setGridMode(mode); setGridParams(null); }}
                    className={`flex-1 py-2 text-sm font-medium cursor-pointer border-0 transition-colors ${
                      gridMode === mode
                        ? "bg-[#14b8a6]/12 text-[#14b8a6] font-semibold"
                        : "bg-transparent text-[#64748b] hover:text-[#f1f5f9]"
                    }`}
                  >
                    {mode === "blind" ? "Blind (auto)" : "Active site"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[#64748b] mt-1">
                {gridMode === "blind"
                  ? "Wraps the entire protein with padding."
                  : "Specify the pocket center and radius."}
              </p>
            </div>

            {/* Active site coords */}
            {gridMode === "active_site" && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  ["Center X", coordX, setCoordX],
                  ["Center Y", coordY, setCoordY],
                  ["Center Z", coordZ, setCoordZ],
                  ["Radius (Å)", radius, setRadius],
                ].map(([label, val, setter]) => (
                  <div key={label as string}>
                    <label className="block text-[10px] font-semibold text-[#64748b] uppercase tracking-wider mb-1">
                      {label as string}
                    </label>
                    <input
                      type="number"
                      value={val as string}
                      onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                      placeholder="0.00"
                      step="0.1"
                      className="w-full bg-[#0f1117] border border-[#1e2433] text-[#f1f5f9] placeholder-[#3a4560] rounded-md px-3 py-2 text-sm outline-none focus:border-[#14b8a6] transition-colors"
                    />
                  </div>
                ))}
              </div>
            )}

            {gridError && (
              <p className="text-red-400 text-xs mb-3">{gridError}</p>
            )}

            <Button
              variant={gridReady ? "secondary" : "primary"}
              size="sm"
              onClick={handleComputeGrid}
              disabled={!chainSelected || computingGrid}
            >
              {computingGrid ? (
                <>
                  <Spinner size="sm" /> Computing…
                </>
              ) : gridReady ? (
                "Re-compute grid"
              ) : (
                "Compute grid"
              )}
            </Button>

            {/* Grid params display */}
            {gridParams && (
              <div className="mt-4 bg-[#0f1117] border border-[#1e2433] rounded-lg p-3">
                <p className="text-[10px] font-semibold text-[#64748b] uppercase tracking-wider mb-2">
                  Grid parameters
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["Center X", gridParams.center_x],
                    ["Center Y", gridParams.center_y],
                    ["Center Z", gridParams.center_z],
                    ["Size X", gridParams.size_x],
                    ["Size Y", gridParams.size_y],
                    ["Size Z", gridParams.size_z],
                  ].map(([label, val]) => (
                    <div
                      key={label as string}
                      className="bg-[#161b27] border border-[#1e2433] rounded p-2"
                    >
                      <div className="text-[10px] text-[#64748b] uppercase tracking-wide mb-0.5">
                        {label as string}
                      </div>
                      <div className="font-mono text-sm text-[#14b8a6]">
                        {val != null ? (val as number).toFixed(2) : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* ── Action row ─────────────────────────────────────────────────── */}
          <div className="bg-[#161b27] border border-[#1e2433] rounded-lg px-5 py-4 flex items-center justify-between gap-4">
            <div className="text-sm text-[#64748b]">
              {canDispatch ? (
                <>
                  Ready:{" "}
                  <strong className="text-[#14b8a6]">{selected.length}</strong>{" "}
                  compound{selected.length !== 1 ? "s" : ""} →{" "}
                  <strong className="text-[#f1f5f9]">{proteinCode}</strong> chain{" "}
                  <strong className="text-[#f1f5f9]">{selectedChain}</strong>
                </>
              ) : (
                "Configure protein and grid to launch docking."
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="ghost" size="md" onClick={() => router.push("/smiles")}>
                ← Back
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={!canDispatch || dispatchMutation.isPending}
                onClick={() => dispatchMutation.mutate()}
              >
                {dispatchMutation.isPending ? (
                  <>
                    <Spinner size="sm" /> Launching…
                  </>
                ) : (
                  "Launch docking →"
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Right column: compound list */}
        <div>
          <div className="bg-[#161b27] border border-[#1e2433] rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1e2433] flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-[#f1f5f9]">Compounds</p>
                <p className="text-xs text-[#64748b]">
                  {selected.length} ready to dock
                </p>
              </div>
              <button
                onClick={() => router.push("/smiles")}
                className="text-xs text-[#64748b] hover:text-[#14b8a6] cursor-pointer bg-transparent border-none"
              >
                Edit ↗
              </button>
            </div>
            <div className="p-3 max-h-80 overflow-y-auto flex flex-col gap-1.5">
              {selected.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 px-3 py-2 bg-[#0f1117] border border-[#1e2433] rounded"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#14b8a6] shrink-0" />
                  <span
                    className="text-xs text-[#f1f5f9] font-medium truncate"
                    title={c.name}
                  >
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle: string;
  badge: { label: string; cls: string };
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[#161b27] border border-[#1e2433] rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-[#1e2433] flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#f1f5f9]">{title}</p>
          <p className="text-xs text-[#64748b]">{subtitle}</p>
        </div>
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold shrink-0 ${badge.cls}`}
        >
          {badge.label}
        </span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
