"use client";

import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { validateSmiles } from "@/lib/api";
import {
  useCompoundSelection,
  type SelectedCompound,
} from "@/contexts/CompoundSelectionContext";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import type { SmilesResult } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type EntryStatus = "pending" | "valid" | "invalid" | "no-smiles";

interface CompoundEntry {
  id: string;
  name: string;
  smiles: string;
  status: EntryStatus;
  props: SmilesResult | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, d: number) {
  return v == null ? "—" : v.toFixed(d);
}

let _manualCounter = 0;

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SmilesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { selected, setSelected } = useCompoundSelection();

  const [entries, setEntries] = useState<CompoundEntry[]>(() =>
    selected.map((c) => ({
      id: c.id,
      name: c.name,
      smiles: c.smiles.trim(),
      status: c.smiles.trim() ? "pending" : "no-smiles",
      props: null,
    }))
  );

  const [manualInput, setManualInput] = useState("");

  const validateMutation = useMutation({
    mutationFn: (smilesList: string[]) => validateSmiles(smilesList),
  });

  // ── Counts ──────────────────────────────────────────────────────────────────

  const total = entries.length;
  const valid = entries.filter((e) => e.status === "valid").length;
  const invalid = entries.filter((e) => e.status === "invalid").length;
  const pending = total - valid - invalid;

  // ── Handlers ────────────────────────────────────────────────────────────────

  function updateSmiles(id: string, val: string) {
    setEntries((prev) =>
      prev.map((e) =>
        e.id !== id
          ? e
          : {
              ...e,
              smiles: val,
              status: val.trim() ? "pending" : "no-smiles",
              props: null,
            }
      )
    );
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function removeInvalid() {
    setEntries((prev) => prev.filter((e) => e.status !== "invalid"));
  }

  function addManualSmiles() {
    const lines = manualInput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;
    const newEntries: CompoundEntry[] = lines.map((smiles) => ({
      id: `manual_${_manualCounter++}`,
      name: `Manual compound ${_manualCounter}`,
      smiles,
      status: "pending",
      props: null,
    }));
    setEntries((prev) => [...prev, ...newEntries]);
    setManualInput("");
  }

  async function handleValidate() {
    const toValidate = entries
      .map((e, i) => ({ entry: e, idx: i }))
      .filter(({ entry }) => entry.smiles.trim());

    if (!toValidate.length) {
      showToast("No SMILES to validate.", "error");
      return;
    }

    const smilesList = toValidate.map(({ entry }) => entry.smiles.trim());

    validateMutation.mutate(smilesList, {
      onSuccess: (results) => {
        setEntries((prev) => {
          const updated = prev.map((e) =>
            !e.smiles.trim() ? { ...e, status: "no-smiles" as EntryStatus } : e
          );
          toValidate.forEach(({ idx }, ri) => {
            const r = results[ri];
            if (!r) return;
            updated[idx] = {
              ...updated[idx],
              smiles: r.smiles || updated[idx].smiles,
              status: r.is_valid ? "valid" : "invalid",
              props: r,
            };
          });
          return updated;
        });
      },
      onError: () => showToast("Validation failed. Is the API running?", "error"),
    });
  }

  function handleContinue() {
    const validEntries = entries.filter((e) => e.status === "valid");
    if (!validEntries.length) {
      showToast("Validate SMILES first — no valid compounds to proceed.", "error");
      return;
    }
    const updated: SelectedCompound[] = validEntries.map((e) => ({
      id: e.id,
      name: e.name,
      smiles: e.smiles,
    }));
    setSelected(updated);
    router.push("/docking");
  }

  // ── Empty state ──────────────────────────────────────────────────────────────

  if (entries.length === 0 && selected.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-5xl mb-4">🔍</div>
        <h2 className="text-xl font-semibold mb-2">No compounds selected</h2>
        <p className="text-[#64748b] text-sm mb-6 max-w-sm">
          Go back to Step 1 and select at least one compound to prepare for
          docking.
        </p>
        <Button onClick={() => router.push("/")}>← Go to Search</Button>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="pb-20">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total", value: total, color: "text-[#14b8a6]" },
          { label: "Valid SMILES", value: valid, color: "text-green-400" },
          { label: "Invalid", value: invalid, color: "text-red-400" },
          { label: "Not validated", value: pending, color: "text-[#64748b]" },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="bg-[#161b27] border border-[#1e2433] rounded-lg p-4"
          >
            <div className={`font-mono text-2xl font-medium mb-1 ${color}`}>
              {value}
            </div>
            <div className="text-xs text-[#64748b] uppercase tracking-wider">
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <span className="text-xs text-[#64748b]">
          <strong className="text-[#f1f5f9]">{total}</strong> compound
          {total !== 1 ? "s" : ""} loaded
        </span>
        <div className="flex gap-2">
          {invalid > 0 && (
            <Button variant="danger" size="sm" onClick={removeInvalid}>
              Remove invalid ({invalid})
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleValidate}
            disabled={validateMutation.isPending}
          >
            {validateMutation.isPending ? (
              <>
                <Spinner size="sm" /> Validating…
              </>
            ) : valid > 0 ? (
              "Re-validate"
            ) : (
              "Validate SMILES"
            )}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#161b27] border border-[#1e2433] rounded-lg overflow-hidden overflow-x-auto mb-6">
        <table className="w-full border-collapse min-w-[700px]">
          <thead className="bg-[#141927] border-b border-[#1e2433]">
            <tr>
              <th className="px-2 py-2.5 w-8" />
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-[#64748b] uppercase tracking-wider">
                Compound name
              </th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-[#64748b] uppercase tracking-wider min-w-[280px]">
                SMILES
              </th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-[#64748b] uppercase tracking-wider">
                Status
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-[#64748b] uppercase tracking-wider">
                MW
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-[#64748b] uppercase tracking-wider">
                LogP
              </th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-[#64748b] uppercase tracking-wider">
                Drug-like
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="text-center py-10 text-[#64748b] text-sm"
                >
                  All compounds removed.{" "}
                  <button
                    onClick={() => router.push("/")}
                    className="text-[#14b8a6] underline cursor-pointer bg-transparent border-none"
                  >
                    Go back to search.
                  </button>
                </td>
              </tr>
            )}
            {entries.map((entry, i) => {
              const rowBg =
                entry.status === "valid"
                  ? "bg-green-500/5"
                  : entry.status === "invalid"
                    ? "bg-red-500/5"
                    : i % 2 === 0
                      ? "bg-[#161b27]"
                      : "bg-[#131820]";

              const inputBorder =
                entry.status === "valid"
                  ? "border-green-500/40"
                  : entry.status === "invalid"
                    ? "border-red-500/40"
                    : "border-[#2a3145]";

              return (
                <tr
                  key={entry.id}
                  className={`border-b border-[#1e2433] last:border-b-0 ${rowBg}`}
                >
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => removeEntry(entry.id)}
                      title="Remove"
                      className="text-[#3a4560] hover:text-red-400 hover:bg-red-500/10 w-6 h-6 rounded flex items-center justify-center cursor-pointer bg-transparent border-none text-lg leading-none"
                    >
                      ×
                    </button>
                  </td>
                  <td
                    className="px-3 py-2 font-medium text-[#f1f5f9] max-w-[180px]"
                    title={entry.name}
                  >
                    <span className="block truncate text-sm">{entry.name}</span>
                  </td>
                  <td className="px-3 py-2 min-w-[280px]">
                    <input
                      type="text"
                      value={entry.smiles}
                      onChange={(e) => updateSmiles(entry.id, e.target.value)}
                      placeholder="Enter SMILES…"
                      spellCheck={false}
                      autoComplete="off"
                      className={`w-full bg-[#0f1117] border ${inputBorder} text-[#f1f5f9] placeholder-[#3a4560] rounded px-2 py-1 font-mono text-xs outline-none focus:border-[#14b8a6] transition-colors`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={entry.status} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-[#94a3b8]">
                    {entry.props ? fmt(entry.props.molecular_weight, 1) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-[#94a3b8]">
                    {entry.props ? fmt(entry.props.logp, 2) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {entry.props == null ? (
                      <span className="text-[#3a4560] text-sm">—</span>
                    ) : entry.props.lipinski_pass ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/12 text-green-400">
                        ✓ Yes
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#64748b]/10 text-[#475569]">
                        ✗ No
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Manual SMILES input */}
      <div className="bg-[#161b27] border border-[#1e2433] rounded-lg p-4 mb-4">
        <h3 className="text-sm font-semibold text-[#f1f5f9] mb-2">
          Add compounds manually
        </h3>
        <p className="text-xs text-[#64748b] mb-3">
          Enter one SMILES string per line. Each line becomes a new compound.
        </p>
        <textarea
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          placeholder={`CC(=O)Oc1ccccc1C(=O)O\nCOc1ccc2c(c1)CC(CO)N2`}
          spellCheck={false}
          rows={4}
          className="w-full bg-[#0f1117] border border-[#1e2433] text-[#f1f5f9] placeholder-[#3a4560] rounded px-3 py-2 font-mono text-xs outline-none focus:border-[#14b8a6] transition-colors resize-y mb-3"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={addManualSmiles}
          disabled={!manualInput.trim()}
        >
          Add compounds
        </Button>
      </div>

      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 h-16 bg-[#161b27]/95 backdrop-blur border-t border-[#1e2433] flex items-center justify-between px-8 z-20">
        <div className="text-sm text-[#64748b]">
          {valid > 0 ? (
            <>
              <strong className="text-[#14b8a6] font-mono">{valid}</strong>{" "}
              valid compound{valid !== 1 ? "s" : ""} ready for docking
            </>
          ) : (
            "Validate SMILES to continue"
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="md" onClick={() => router.push("/")}>
            ← Back to search
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={valid === 0}
            onClick={handleContinue}
          >
            {valid > 0 ? `Send ${valid} to docking →` : "Continue to docking →"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: EntryStatus }) {
  const map: Record<EntryStatus, { label: string; cls: string }> = {
    pending: {
      label: "Pending",
      cls: "bg-[#64748b]/12 text-[#64748b]",
    },
    valid: {
      label: "✓ Valid",
      cls: "bg-green-500/12 text-green-400",
    },
    invalid: {
      label: "✗ Invalid",
      cls: "bg-red-500/12 text-red-400",
    },
    "no-smiles": {
      label: "No SMILES",
      cls: "bg-yellow-500/12 text-yellow-400",
    },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}
