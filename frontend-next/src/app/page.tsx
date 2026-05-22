"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { searchCompounds, getStats, exportCompoundsCsvUrl } from "@/lib/api";
import {
  useCompoundSelection,
  type SelectedCompound,
} from "@/contexts/CompoundSelectionContext";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import type { Phytochemical } from "@/lib/types";

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

type SortKey = "name" | "source_plant" | "molecular_weight" | "logp";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(val: number | null | undefined, decimals: number): string {
  return val == null ? "—" : val.toFixed(decimals);
}

function downloadBlob(data: Blob | string, filename: string, mime: string) {
  const blob =
    data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0 border-0 p-0 ${
          checked ? "bg-[#14b8a6]/30" : "bg-[#1e2433]"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200 ${
            checked
              ? "left-[calc(100%-18px)] bg-[#14b8a6]"
              : "left-0.5 bg-[#64748b]"
          }`}
        />
      </button>
      <span className="text-xs text-[#94a3b8] font-medium">{label}</span>
    </label>
  );
}

// ── SortTh ───────────────────────────────────────────────────────────────────

function SortTh({
  col,
  label,
  right,
  sortBy,
  sortDir,
  onSort,
}: {
  col: SortKey;
  label: string;
  right?: boolean;
  sortBy: SortKey;
  sortDir: "asc" | "desc";
  onSort: (col: SortKey) => void;
}) {
  const active = sortBy === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-3 py-2.5 text-[10px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-[#94a3b8] transition-colors ${
        right ? "text-right" : "text-left"
      } ${active ? "text-[#94a3b8]" : ""}`}
    >
      {label}
      <span className="ml-1 inline-block w-3 text-center">
        {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </span>
    </th>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SearchPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { selected, selectedIds, addCompound, removeCompound, addMany, removeMany, clearAll } =
    useCompoundSelection();

  // ── Filter state ──────────────────────────────────────────────────────────

  const [nameInput, setNameInput] = useState("");
  const [plantInput, setPlantInput] = useState("");
  const [lipinskiOnly, setLipinskiOnly] = useState(false);
  const [smilesOnly, setSmilesOnly] = useState(false);

  // committed (debounced) filter values used as query key
  const [committedName, setCommittedName] = useState("");
  const [committedPlant, setCommittedPlant] = useState("");
  const [page, setPage] = useState(1);

  // Sort state
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Debounce name input
  useEffect(() => {
    const t = setTimeout(() => {
      setCommittedName(nameInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [nameInput]);

  // Debounce plant input
  useEffect(() => {
    const t = setTimeout(() => {
      setCommittedPlant(plantInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [plantInput]);

  // Reset page when toggles change
  useEffect(() => setPage(1), [lipinskiOnly, smilesOnly]);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => getStats(),
    refetchInterval: 60_000,
  });

  const filters = useMemo(
    () => ({
      name: committedName || undefined,
      source_plant: committedPlant || undefined,
      lipinski_pass: lipinskiOnly || undefined,
      has_smiles: smilesOnly || undefined,
    }),
    [committedName, committedPlant, lipinskiOnly, smilesOnly]
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ["compounds", filters, page],
    queryFn: () =>
      searchCompounds({
        ...filters,
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });

  // ── Derived state ─────────────────────────────────────────────────────────

  const compounds = data?.compounds ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const skip = (page - 1) * PAGE_SIZE;
  const end = Math.min(skip + compounds.length, totalCount);

  const sorted = useMemo(() => {
    return [...compounds].sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp =
        typeof va === "string"
          ? va.localeCompare(vb as string)
          : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [compounds, sortBy, sortDir]);

  const pageIds = useMemo(() => sorted.map((c) => c.id), [sorted]);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected =
    !allPageSelected && pageIds.some((id) => selectedIds.has(id));

  // ── Sort handler ──────────────────────────────────────────────────────────

  function handleSort(col: SortKey) {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  }

  // ── Selection handlers ────────────────────────────────────────────────────

  function toggleRow(compound: Phytochemical) {
    const c: SelectedCompound = {
      id: compound.id,
      name: compound.name,
      smiles: compound.smiles ?? "",
    };
    if (selectedIds.has(compound.id)) {
      removeCompound(compound.id);
    } else {
      addCompound(c);
    }
  }

  function toggleSelectAll() {
    if (allPageSelected) {
      removeMany(pageIds);
    } else {
      const toAdd = sorted.map((c) => ({
        id: c.id,
        name: c.name,
        smiles: c.smiles ?? "",
      }));
      addMany(toAdd);
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  function exportCsv() {
    if (selected.length > 0) {
      const header = "id,name,smiles";
      const rows = selected
        .map(
          (c) =>
            `${c.id},"${c.name.replace(/"/g, '""')}","${(c.smiles || "").replace(/"/g, '""')}"`
        )
        .join("\n");
      downloadBlob(header + "\n" + rows, "selected_compounds.csv", "text/csv");
    } else {
      window.open(exportCompoundsCsvUrl(filters), "_blank");
    }
  }

  // ── Send to docking ───────────────────────────────────────────────────────

  function sendToDocking() {
    if (selected.length === 0) {
      showToast("Select at least one compound before continuing.", "error");
      return;
    }
    router.push("/smiles");
  }

  // ── Clear filters ─────────────────────────────────────────────────────────

  function clearFilters() {
    setNameInput("");
    setPlantInput("");
    setLipinskiOnly(false);
    setSmilesOnly(false);
    setPage(1);
  }

  // ── Row count text ────────────────────────────────────────────────────────

  let rowCountText = "Loading…";
  if (!isLoading && !isError) {
    if (totalCount === 0) {
      rowCountText = "No compounds found";
    } else {
      rowCountText = `Showing ${(skip + 1).toLocaleString()}–${end.toLocaleString()} of ${totalCount.toLocaleString()} compounds`;
    }
  }
  if (isError) rowCountText = "Failed to load compounds";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="pb-20">
      {/* Stats bar */}
      <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-4">
        <StatCard label="Total compounds" value={stats?.total.toLocaleString()} />
        <StatCard label="With SMILES" value={stats?.with_smiles.toLocaleString()} />
        <StatCard label="Drug-like (Lipinski)" value={stats?.lipinski_pass.toLocaleString()} />
        <StatCard label="Ready to dock" value={stats?.with_smiles.toLocaleString()} />
      </div>

      {/* Filter bar */}
      <div className="bg-[#161b27] border border-[#1e2433] rounded-lg px-4 py-3 mb-4 flex flex-wrap gap-3 items-center">
        <input
          type="text"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          placeholder="Search by compound name…"
          autoComplete="off"
          spellCheck={false}
          className="bg-[#0f1117] border border-[#1e2433] text-[#f1f5f9] placeholder-[#4a5568] rounded-md px-3 py-2 text-sm outline-none focus:border-[#14b8a6] transition-colors min-w-[200px]"
        />
        <input
          type="text"
          value={plantInput}
          onChange={(e) => setPlantInput(e.target.value)}
          placeholder="Filter by plant name…"
          autoComplete="off"
          spellCheck={false}
          className="bg-[#0f1117] border border-[#1e2433] text-[#f1f5f9] placeholder-[#4a5568] rounded-md px-3 py-2 text-sm outline-none focus:border-[#14b8a6] transition-colors min-w-[180px]"
        />

        <div className="w-px h-7 bg-[#1e2433] shrink-0 hidden sm:block" />

        <Toggle
          checked={lipinskiOnly}
          onChange={setLipinskiOnly}
          label="Drug-like only"
        />
        <Toggle
          checked={smilesOnly}
          onChange={setSmilesOnly}
          label="Ready to dock only"
        />

        <div className="w-px h-7 bg-[#1e2433] shrink-0 hidden sm:block" />

        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      </div>

      {/* Results header */}
      <div className="flex justify-between items-center mb-3">
        <span className="text-xs text-[#64748b]">{rowCountText}</span>
      </div>

      {/* Table */}
      <div className="bg-[#161b27] border border-[#1e2433] rounded-lg overflow-hidden overflow-x-auto mb-4">
        <table className="w-full border-collapse min-w-[720px]">
          <thead className="bg-[#141927] border-b border-[#1e2433]">
            <tr>
              <th className="px-3 py-2.5 text-center w-10">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = somePageSelected;
                  }}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 accent-[#14b8a6] cursor-pointer"
                  title="Select all on this page"
                />
              </th>
              <SortTh
                col="name"
                label="Compound name"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortTh
                col="source_plant"
                label="Plant source"
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortTh
                col="molecular_weight"
                label="MW (g/mol)"
                right
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <SortTh
                col="logp"
                label="LogP"
                right
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
              />
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-[#64748b] uppercase tracking-wider whitespace-nowrap">
                Drug-like
              </th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-[#64748b] uppercase tracking-wider w-44">
                SMILES
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="text-center py-12">
                  <div className="flex items-center justify-center gap-2 text-[#64748b] text-sm">
                    <Spinner size="sm" />
                    Loading compounds…
                  </div>
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td
                  colSpan={7}
                  className="text-center py-12 text-[#ef4444] text-sm"
                >
                  Failed to load compounds. Make sure the API is running.
                </td>
              </tr>
            )}
            {!isLoading && !isError && sorted.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="text-center py-12 text-[#64748b] text-sm"
                >
                  No compounds found. Try different filters.
                </td>
              </tr>
            )}
            {!isLoading &&
              sorted.map((compound, i) => {
                const isSelected = selectedIds.has(compound.id);
                return (
                  <tr
                    key={compound.id}
                    onClick={() => toggleRow(compound)}
                    className={`border-b border-[#1e2433] last:border-b-0 cursor-pointer transition-colors text-sm ${
                      isSelected
                        ? "bg-[#14b8a6]/10"
                        : i % 2 === 0
                          ? "bg-[#161b27] hover:bg-[#1e2840]"
                          : "bg-[#131820] hover:bg-[#1e2840]"
                    }`}
                  >
                    <td
                      className="px-3 py-2.5 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(compound)}
                        className="w-4 h-4 accent-[#14b8a6] cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-medium text-[#f1f5f9] max-w-[240px]">
                      <span className="block truncate" title={compound.name}>
                        {compound.name}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[#64748b] max-w-[180px]">
                      <span
                        className="block truncate"
                        title={compound.source_plant ?? ""}
                      >
                        {compound.source_plant ?? (
                          <span className="text-[#3a4560]">—</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-[#94a3b8]">
                      {fmt(compound.molecular_weight, 1)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-[#94a3b8]">
                      {fmt(compound.logp, 2)}
                    </td>
                    <td className="px-3 py-2.5">
                      {compound.lipinski_pass === true ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/12 text-green-400">
                          ✓ Yes
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-[#64748b]/10 text-[#475569]">
                          ✗ No
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 w-44">
                      {compound.smiles ? (
                        <span
                          className="block font-mono text-xs text-[#64748b] truncate"
                          title={compound.smiles}
                        >
                          {compound.smiles}
                        </span>
                      ) : (
                        <span className="text-[#3a4560]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-4 mb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
        >
          ← Previous
        </Button>
        <span className="text-xs text-[#64748b] min-w-[100px] text-center">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
        >
          Next →
        </Button>
      </div>

      {/* Selection bar — fixed bottom */}
      <div className="fixed bottom-0 left-[220px] right-0 h-16 bg-[#161b27]/95 backdrop-blur border-t border-[#1e2433] flex items-center justify-between px-8 z-20">
        <div className="text-sm text-[#64748b]">
          <strong className="text-[#14b8a6] font-mono">
            {selected.length.toLocaleString()}
          </strong>{" "}
          compound{selected.length !== 1 ? "s" : ""} selected
          {selected.length > 0 && (
            <button
              onClick={clearAll}
              className="ml-3 text-xs text-[#64748b] hover:text-[#94a3b8] underline cursor-pointer bg-transparent border-none"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="md" onClick={exportCsv}>
            Export CSV
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={selected.length === 0}
            onClick={sendToDocking}
          >
            Send to docking →
          </Button>
        </div>
      </div>
    </div>
  );
}
