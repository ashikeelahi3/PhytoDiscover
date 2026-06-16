"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  searchCompounds,
  getProtein,
  getChains,
  computeGridBox,
  dispatchJob,
} from "@/lib/api";
import {
  useCompoundSelection,
  type SelectedCompound,
} from "@/contexts/CompoundSelectionContext";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import type { GridMode, Phytochemical } from "@/lib/types";
import FileUploader from "@/components/FileUploader";
import { ProteinViewer } from "@/components/ProteinViewer";

// ── Types ─────────────────────────────────────────────────────────────────────

type CompoundTab = "tree" | "phyto";
type PhytoMode = "name" | "smiles";

interface ProteinRow {
  rowId: string;
  input: string;
  code: string;
  chains: string[];
  chain: string;
  gridMode: GridMode;
  gridParams: Record<string, number> | null;
  status: "idle" | "fetching" | "ready" | "error";
  error: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2);
}

function emptyRow(): ProteinRow {
  return {
    rowId: uid(),
    input: "",
    code: "",
    chains: [],
    chain: "",
    gridMode: "blind",
    gridParams: null,
    status: "idle",
    error: null,
  };
}

function fmt(v: number | null | undefined, d: number) {
  return v == null ? "—" : v.toFixed(d);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 text-xs font-semibold rounded transition-colors cursor-pointer border-0"
      style={{
        backgroundColor: active ? "#14b8a6" : "var(--bg-card-inner)",
        color: active ? "#000" : "var(--text-secondary)",
      }}
    >
      {children}
    </button>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer bg-transparent outline-none"
      style={{
        borderBottomColor: active ? "#14b8a6" : "transparent",
        color: active ? "#14b8a6" : "var(--text-secondary)",
      }}
    >
      {children}
    </button>
  );
}

function CompoundRow({
  c,
  selected,
  onToggle,
}: {
  c: Phytochemical;
  selected: boolean;
  onToggle: (c: Phytochemical) => void;
}) {
  return (
    <tr
      onClick={() => onToggle(c)}
      className="border-b cursor-pointer transition-colors"
      style={{
        borderColor: "var(--border)",
        backgroundColor: selected ? "rgba(20,184,166,0.07)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!selected)
          e.currentTarget.style.backgroundColor =
            "var(--bg-card-inner)";
      }}
      onMouseLeave={(e) => {
        if (!selected)
          e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      <td className="px-3 py-2 w-8" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(c)}
          className="w-4 h-4 cursor-pointer accent-[#14b8a6]"
        />
      </td>
      <td
        className="px-3 py-2 text-sm font-medium max-w-[200px]"
        style={{ color: "var(--text-primary)" }}
      >
        <span className="block truncate" title={c.name}>
          {c.name}
        </span>
      </td>
      <td
        className="px-3 py-2 text-xs max-w-[140px]"
        style={{ color: "var(--text-secondary)" }}
      >
        <span className="block truncate" title={c.source_plant ?? ""}>
          {c.source_plant ?? "—"}
        </span>
      </td>
      <td
        className="px-3 py-2 text-right font-mono text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        {fmt(c.molecular_weight, 0)}
      </td>
      <td className="px-3 py-2 text-center">
        {c.smiles ? (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: "#14b8a6" }}
            title="Has SMILES"
          />
        ) : (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: "var(--border)" }}
            title="No SMILES"
          />
        )}
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { selected, selectedIds, addCompound, removeCompound, addMany, removeMany, setSelected, clearAll } =
    useCompoundSelection();

  // ── Compound section state ────────────────────────────────────────────────
  const [tab, setTab] = useState<CompoundTab>("tree");
  const [phytoMode, setPhytoMode] = useState<PhytoMode>("name");

  // Tree tab
  const [plantInput, setPlantInput] = useState("");
  const [committedPlant, setCommittedPlant] = useState("");

  // Phyto tab
  const [nameInput, setNameInput] = useState("");
  const [committedName, setCommittedName] = useState("");

  // SMILES direct entry
  const [smilesInput, setSmilesInput] = useState("");

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;

  // Debounce plant input
  useEffect(() => {
    const t = setTimeout(() => { setCommittedPlant(plantInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [plantInput]);

  // Debounce name input
  useEffect(() => {
    const t = setTimeout(() => { setCommittedName(nameInput); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [nameInput]);

  // Build query params
  const queryParams = useMemo(() => {
    if (tab === "tree") {
      return committedPlant ? { source_plant: committedPlant } : null;
    }
    if (phytoMode === "name") {
      return committedName ? { name: committedName } : null;
    }
    return null; // SMILES mode doesn't query
  }, [tab, committedPlant, phytoMode, committedName]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["compounds-home", queryParams, page],
    queryFn: () =>
      searchCompounds({
        ...queryParams,
        has_smiles: true,
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    enabled: queryParams !== null,
    placeholderData: (prev) => prev,
  });

  const compounds = data?.compounds ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  function toggleCompound(c: Phytochemical) {
    const sc: SelectedCompound = { id: c.id, name: c.name, smiles: c.smiles ?? "" };
    if (selectedIds.has(c.id)) removeCompound(c.id);
    else addCompound(sc);
  }

  function selectAllVisible() {
    const toAdd = compounds
      .filter((c) => c.smiles)
      .map((c) => ({ id: c.id, name: c.name, smiles: c.smiles! }));
    addMany(toAdd);
  }

  function addSmilesEntries() {
    const lines = smilesInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) return;
    const entries: SelectedCompound[] = lines.map((smiles, i) => ({
      id: `smiles-${uid()}`,
      name: `SMILES entry ${i + 1}`,
      smiles,
    }));
    addMany(entries);
    setSmilesInput("");
    showToast(`Added ${entries.length} SMILES entries`, "success");
  }

  // ── Protein rows state ───────────────────────────────────────────────────
  const [rows, setRows] = useState<ProteinRow[]>([emptyRow()]);
  const [dispatching, setDispatching] = useState(false);
  const fetchTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function updateRow(rowId: string, patch: Partial<ProteinRow>) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(rowId: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.rowId !== rowId) : prev));
  }

  // Auto-fetch protein when input changes (debounced)
  const scheduleAutoFetch = useCallback(
    (rowId: string, input: string) => {
      if (fetchTimeouts.current[rowId]) {
        clearTimeout(fetchTimeouts.current[rowId]);
      }
      const clean = input.trim().toUpperCase();
      if (clean.length < 4) {
        updateRow(rowId, { code: "", chains: [], chain: "", gridParams: null, status: "idle", error: null });
        return;
      }
      fetchTimeouts.current[rowId] = setTimeout(() => {
        fetchRowProtein(rowId, clean);
      }, 700);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  async function fetchRowProtein(rowId: string, code: string) {
    updateRow(rowId, { status: "fetching", error: null });
    try {
      const [, chainsData] = await Promise.all([getProtein(code), getChains(code)]);
      const recommended = chainsData.recommended ?? chainsData.chains[0] ?? "";
      updateRow(rowId, {
        code,
        chains: chainsData.chains,
        chain: recommended,
        status: "fetching",
        error: null,
      });
      // Auto-compute blind grid
      if (recommended) {
        await computeRowGrid(rowId, code, recommended, "blind");
      }
    } catch {
      updateRow(rowId, { status: "error", code: "", chains: [], chain: "", gridParams: null, error: `Could not load protein "${code}"` });
    }
  }

  async function computeRowGrid(
    rowId: string,
    code: string,
    chain: string,
    gridMode: GridMode,
  ) {
    try {
      const result = await computeGridBox({ protein_code: code, chain, mode: gridMode });
      updateRow(rowId, { gridParams: result.grid_params, status: "ready" });
    } catch {
      updateRow(rowId, { status: "error", error: "Grid computation failed" });
    }
  }

  // ── Run docking ──────────────────────────────────────────────────────────
  const readyRows = rows.filter((r) => r.status === "ready" && r.gridParams);
  const canRun = selected.length > 0 && readyRows.length > 0 && !dispatching;

  async function handleRunDocking() {
    if (!canRun) return;
    setDispatching(true);

    const jobMap: Record<string, string> = JSON.parse(
      sessionStorage.getItem("pd_job_proteins") ?? "{}"
    );

    // DB compounds go via compound_ids only; raw SMILES entries (no DB id) go via smiles_list only.
    // Sending a compound in both lists causes the backend to dock it twice.
    const dbCompounds  = selected.filter((c) => !c.id.startsWith("smiles-"));
    const rawCompounds = selected.filter((c) =>  c.id.startsWith("smiles-"));

    let launched = 0;
    for (const row of readyRows) {
      try {
        const resp = await dispatchJob({
          protein_code: row.code,
          chain: row.chain,
          compound_ids: dbCompounds.map((c) => c.id),
          smiles_list: rawCompounds.map((c) => c.smiles).filter(Boolean),
          plant_name: null,
          grid_mode: row.gridMode,
          grid_params: row.gridParams!,
        });
        jobMap[resp.job_id] = row.code;
        launched++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        showToast(`Failed to launch for ${row.code}: ${msg}`, "error");
      }
    }

    sessionStorage.setItem("pd_job_proteins", JSON.stringify(jobMap));
    setDispatching(false);

    if (launched > 0) {
      showToast(
        `Launched ${launched} docking job${launched !== 1 ? "s" : ""} for ${selected.length} compound${selected.length !== 1 ? "s" : ""}`,
        "success"
      );
      setTimeout(() => router.push("/results"), 600);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const cardStyle = {
    backgroundColor: "var(--bg-card)",
    border: "1px solid var(--border)",
  };

  const inputStyle = {
    backgroundColor: "var(--bg-card-inner)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 13,
    outline: "none",
    width: "100%",
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 pb-28 space-y-6">

      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
          PhytoDiscover
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
          Search compounds, choose protein targets, and run molecular docking.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6 items-start">

        {/* ════ LEFT: Compound input ════ */}
        <div className="rounded-xl overflow-hidden" style={cardStyle}>
          {/* Tabs */}
          <div
            className="flex border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <TabBtn active={tab === "tree"} onClick={() => { setTab("tree"); setPage(1); }}>
              Tree Name
            </TabBtn>
            <TabBtn active={tab === "phyto"} onClick={() => { setTab("phyto"); setPage(1); }}>
              Phytochemicals
            </TabBtn>
          </div>

          <div className="p-4 space-y-3">
            {/* Tree Name tab */}
            {tab === "tree" && (
              <div>
                <input
                  value={plantInput}
                  onChange={(e) => setPlantInput(e.target.value)}
                  placeholder="Enter plant name, e.g. Ocimum basilicum"
                  style={inputStyle}
                  autoComplete="off"
                  spellCheck={false}
                />
                <FileUploader />
                <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
                  Shows only compounds with SMILES (dockable).
                </p>
              </div>
            )}

            {/* Phytochemicals tab */}
            {tab === "phyto" && (
              <div className="space-y-3">
                <div className="flex gap-1">
                  <SegBtn active={phytoMode === "name"} onClick={() => setPhytoMode("name")}>
                    NAME
                  </SegBtn>
                  <SegBtn active={phytoMode === "smiles"} onClick={() => setPhytoMode("smiles")}>
                    SMILES
                  </SegBtn>
                </div>

                {phytoMode === "name" && (
                  <input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Compound name, e.g. Quercetin"
                    style={inputStyle}
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}

                {phytoMode === "smiles" && (
                  <div className="space-y-2">
                    <textarea
                      value={smilesInput}
                      onChange={(e) => setSmilesInput(e.target.value)}
                      placeholder={"Paste SMILES strings, one per line:\nC1=CC=CC=C1\nCC(=O)Oc1ccccc1C(=O)O"}
                      rows={4}
                      style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-ibm-plex-mono)" }}
                    />
                    <button
                      onClick={addSmilesEntries}
                      disabled={!smilesInput.trim()}
                      className="px-4 py-1.5 rounded text-sm font-semibold cursor-pointer transition-opacity border-0"
                      style={{
                        backgroundColor: "#14b8a6",
                        color: "#000",
                        opacity: smilesInput.trim() ? 1 : 0.4,
                      }}
                    >
                      Add SMILES entries
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Results table */}
            {phytoMode !== "smiles" && queryParams !== null && (
              <div>
                {/* Table header */}
                <div
                  className="flex items-center justify-between py-1.5 px-1"
                >
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {isLoading ? "Loading…" : isError ? "Failed to load" : `${totalCount.toLocaleString()} results`}
                  </span>
                  {compounds.length > 0 && (
                    <button
                      onClick={selectAllVisible}
                      className="text-xs cursor-pointer bg-transparent border-0 transition-colors"
                      style={{ color: "#14b8a6" }}
                    >
                      Select all visible
                    </button>
                  )}
                </div>

                <div
                  className="rounded-lg overflow-hidden overflow-x-auto"
                  style={{ border: "1px solid var(--border)" }}
                >
                  <table className="w-full border-collapse min-w-[480px]">
                    <thead>
                      <tr style={{ backgroundColor: "var(--bg-table-header)" }}>
                        <th className="w-8 px-3 py-2" />
                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                          Compound
                        </th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                          Plant
                        </th>
                        <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                          MW
                        </th>
                        <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                          SMILES
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoading && (
                        <tr>
                          <td colSpan={5} className="text-center py-8">
                            <div className="flex items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}>
                              <Spinner size="sm" />
                              <span className="text-sm">Loading…</span>
                            </div>
                          </td>
                        </tr>
                      )}
                      {!isLoading && compounds.length === 0 && !isError && (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-sm" style={{ color: "var(--text-muted)" }}>
                            No compounds found.
                          </td>
                        </tr>
                      )}
                      {!isLoading && compounds.map((c) => (
                        <CompoundRow
                          key={c.id}
                          c={c}
                          selected={selectedIds.has(c.id)}
                          onToggle={toggleCompound}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-4 mt-3">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="text-xs px-3 py-1 rounded border cursor-pointer bg-transparent transition-colors disabled:opacity-40"
                      style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                    >
                      ← Prev
                    </button>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {page} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="text-xs px-3 py-1 rounded border cursor-pointer bg-transparent transition-colors disabled:opacity-40"
                      style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Selection summary */}
            {selected.length > 0 && (
              <div
                className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ backgroundColor: "rgba(20,184,166,0.08)", border: "1px solid rgba(20,184,166,0.2)" }}
              >
                <span className="text-sm font-medium" style={{ color: "#14b8a6" }}>
                  {selected.length} compound{selected.length !== 1 ? "s" : ""} selected
                </span>
                <button
                  onClick={clearAll}
                  className="text-xs cursor-pointer bg-transparent border-0 transition-colors"
                  style={{ color: "var(--text-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ════ RIGHT: Protein Targets ════ */}
        <div className="rounded-xl overflow-hidden" style={cardStyle}>
          <div
            className="px-4 py-3 border-b flex items-center justify-between"
            style={{ borderColor: "var(--border)" }}
          >
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Multiplex Protein Docking
              </h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                One job dispatched per protein target
              </p>
            </div>
          </div>

          <div className="p-4 space-y-3">
            {rows.map((row, idx) => (
              <ProteinRowCard
                key={row.rowId}
                row={row}
                index={idx}
                canRemove={rows.length > 1}
                onInputChange={(val) => {
                  updateRow(row.rowId, { input: val });
                  scheduleAutoFetch(row.rowId, val);
                }}
                onChainChange={(chain) => {
                  updateRow(row.rowId, { chain, gridParams: null, status: "fetching" });
                  computeRowGrid(row.rowId, row.code, chain, row.gridMode);
                }}
                onRemove={() => removeRow(row.rowId)}
                onRetry={() => fetchRowProtein(row.rowId, row.input.trim().toUpperCase())}
              />
            ))}

            <button
              onClick={addRow}
              className="w-full py-2 text-sm rounded-lg border border-dashed cursor-pointer bg-transparent transition-colors"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#14b8a6";
                e.currentTarget.style.color = "#14b8a6";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              + Add protein
            </button>

            {/* Selected compounds preview */}
            {selected.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
                  Compounds ({selected.length})
                </p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {selected.slice(0, 8).map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-xs"
                      style={{ backgroundColor: "var(--bg-card-inner)" }}
                    >
                      <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: "#14b8a6" }} />
                      <span className="truncate" style={{ color: "var(--text-secondary)" }} title={c.name}>
                        {c.name}
                      </span>
                    </div>
                  ))}
                  {selected.length > 8 && (
                    <p className="text-xs pl-2" style={{ color: "var(--text-muted)" }}>
                      +{selected.length - 8} more
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Fixed bottom bar ── */}
      <div
        className="fixed bottom-0 left-0 right-0 h-16 flex items-center justify-between px-8 z-40"
        style={{
          backgroundColor: "var(--bg-card)",
          borderTop: "1px solid var(--border)",
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {selected.length > 0 ? (
            <>
              <span className="font-mono font-semibold" style={{ color: "#14b8a6" }}>
                {selected.length}
              </span>{" "}
              compound{selected.length !== 1 ? "s" : ""} selected
              {readyRows.length > 0 && (
                <>
                  {" "}·{" "}
                  <span className="font-mono font-semibold" style={{ color: "var(--text-primary)" }}>
                    {readyRows.length}
                  </span>{" "}
                  protein{readyRows.length !== 1 ? "s" : ""} ready
                </>
              )}
            </>
          ) : (
            <span style={{ color: "var(--text-muted)" }}>
              Select compounds and add protein targets to begin.
            </span>
          )}
        </div>

        <button
          onClick={handleRunDocking}
          disabled={!canRun}
          className="px-5 py-2 rounded-lg text-sm font-semibold cursor-pointer border-0 transition-opacity flex items-center gap-2"
          style={{
            backgroundColor: "#14b8a6",
            color: "#000",
            opacity: canRun ? 1 : 0.4,
          }}
        >
          {dispatching ? (
            <>
              <Spinner size="sm" />
              Launching…
            </>
          ) : (
            `Run Docking${readyRows.length > 1 ? ` (${readyRows.length} proteins)` : ""} →`
          )}
        </button>
      </div>
    </div>
  );
}

// ── ProteinRowCard ─────────────────────────────────────────────────────────────

function ProteinRowCard({
  row,
  index,
  canRemove,
  onInputChange,
  onChainChange,
  onRemove,
  onRetry,
}: {
  row: ProteinRow;
  index: number;
  canRemove: boolean;
  onInputChange: (val: string) => void;
  onChainChange: (chain: string) => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const statusColor =
    row.status === "ready"
      ? "#14b8a6"
      : row.status === "error"
        ? "#ef4444"
        : row.status === "fetching"
          ? "#f59e0b"
          : "var(--text-muted)";

  const statusLabel =
    row.status === "ready"
      ? "Ready"
      : row.status === "error"
        ? "Error"
        : row.status === "fetching"
          ? "Loading…"
          : "Idle";

  return (
    <div
      className="rounded-lg p-3 space-y-2"
      style={{
        backgroundColor: "var(--bg-card-inner)",
        border: `1px solid ${row.status === "ready" ? "rgba(20,184,166,0.3)" : row.status === "error" ? "rgba(239,68,68,0.3)" : "var(--border)"}`,
      }}
    >
      {/* Row header */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-medium"
          style={{ color: "var(--text-muted)" }}
        >
          #{index + 1}
        </span>
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: statusColor }}
        />
        <span className="text-xs" style={{ color: statusColor }}>
          {statusLabel}
        </span>
        <div className="flex-1" />
        {row.status === "error" && (
          <button
            onClick={onRetry}
            className="text-xs cursor-pointer bg-transparent border-0 transition-colors"
            style={{ color: "#f59e0b" }}
          >
            Retry
          </button>
        )}
        {canRemove && (
          <button
            onClick={onRemove}
            className="text-xs cursor-pointer bg-transparent border-0 transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = "var(--text-muted)")
            }
            aria-label="Remove protein"
          >
            ✕
          </button>
        )}
      </div>

      {/* Input */}
      <input
        value={row.input}
        onChange={(e) => onInputChange(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const clean = row.input.trim().toUpperCase();
            if (clean.length >= 4) onRetry();
          }
        }}
        placeholder="PDB ID or AlphaFold accession (e.g. 6LU7)"
        maxLength={40}
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded text-sm font-mono outline-none"
        style={{
          backgroundColor: "var(--bg-card)",
          border: "1px solid var(--border)",
          color: "var(--text-primary)",
          padding: "6px 10px",
        }}
        onFocus={(e) => (e.target.style.borderColor = "#14b8a6")}
        onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
      />

      {/* Loading indicator */}
      {row.status === "fetching" && (
        <div
          className="flex items-center gap-2 text-xs"
          style={{ color: "#f59e0b" }}
        >
          <Spinner size="sm" />
          Fetching protein…
        </div>
      )}

      {/* Error */}
      {row.status === "error" && row.error && (
        <p className="text-xs" style={{ color: "#ef4444" }}>
          {row.error}
        </p>
      )}

      {/* Chain selector */}
      {row.chains.length > 0 && row.status !== "fetching" && (
        <div>
          <p
            className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            Chain
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...row.chains].sort().map((ch) => (
              <button
                key={ch}
                onClick={() => onChainChange(ch)}
                className="px-2.5 py-1 rounded text-xs font-mono font-semibold cursor-pointer border transition-colors"
                style={{
                  backgroundColor:
                    row.chain === ch
                      ? "rgba(20,184,166,0.1)"
                      : "var(--bg-card)",
                  borderColor: row.chain === ch ? "#14b8a6" : "var(--border)",
                  color: row.chain === ch ? "#14b8a6" : "var(--text-secondary)",
                }}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Grid params preview */}
      {row.gridParams && row.status === "ready" && (
        <div className="grid grid-cols-3 gap-1.5">
          {[
            ["Cx", row.gridParams.center_x],
            ["Cy", row.gridParams.center_y],
            ["Cz", row.gridParams.center_z],
            ["Sx", row.gridParams.size_x],
            ["Sy", row.gridParams.size_y],
            ["Sz", row.gridParams.size_z],
          ].map(([label, val]) => (
            <div
              key={label as string}
              className="rounded px-2 py-1"
              style={{
                backgroundColor: "var(--bg-card)",
                border: "1px solid var(--border)",
              }}
            >
              <div
                className="text-[9px] uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                {label}
              </div>
              <div
                className="font-mono text-[11px]"
                style={{ color: "#14b8a6" }}
              >
                {(val as number).toFixed(1)}
              </div>
            </div>
          ))}
        </div>
      )}
      <ProteinViewer
        pdbId={row.code || undefined}
        selectedChain={row.chain || undefined}
        gridBox={
          row.gridParams
            ? {
                center: {
                  x: row.gridParams.center_x,
                  y: row.gridParams.center_y,
                  z: row.gridParams.center_z,
                },
                size: {
                  x: row.gridParams.size_x,
                  y: row.gridParams.size_y,
                  z: row.gridParams.size_z,
                },
              }
            : undefined
        }
      />
    </div>
  );
}
