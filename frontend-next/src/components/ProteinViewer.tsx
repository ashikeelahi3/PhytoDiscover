"use client";

import { useEffect, useRef } from "react";
import type { GLViewer } from "3dmol";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProteinViewerProps {
  pdbId?: string;
  pdbContent?: string;
  pdbqtContent?: string;
  selectedChain?: string;
  gridBox?: {
    center: { x: number; y: number; z: number };
    size: { x: number; y: number; z: number };
  };
  height?: string;
  mode?: "cartoon" | "surface" | "stick";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProteinViewer({
  pdbId,
  pdbContent,
  pdbqtContent,
  selectedChain,
  gridBox,
  height = "400px",
  mode = "cartoon",
}: ProteinViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<GLViewer | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    import("3dmol").then(($3Dmol) => {
      if (cancelled || !containerRef.current) return;

      // Wipe any previous canvas so we never stack viewers on one element.
      containerRef.current.innerHTML = "";

      const viewer = ($3Dmol as unknown as {
        createViewer: (el: Element, cfg: object) => GLViewer;
        SurfaceType: { VDW: number };
      }).createViewer(containerRef.current, { backgroundColor: "0x0f1117" });

      viewerRef.current = viewer;

      const render = (proteinPdb: string) => {
        if (cancelled || !viewerRef.current) return;
        const v = viewerRef.current;
        v.clear();

        // ── Protein model ────────────────────────────────────────────────────
        v.addModel(proteinPdb, "pdb");

        if (mode === "cartoon") {
          v.setStyle({}, { cartoon: { color: "0x374151" } });
          if (selectedChain) {
            v.setStyle(
              { chain: selectedChain },
              { cartoon: { color: "0x14b8a6" } }
            );
          }
        } else if (mode === "stick") {
          v.setStyle({}, { stick: { colorscheme: "elementColors" } });
        } else {
          // surface — faint backbone + translucent VDW surface
          v.setStyle({}, { cartoon: { color: "0x374151", opacity: 0.15 } });
          v.addSurface(
            ($3Dmol as unknown as { SurfaceType: { VDW: number } }).SurfaceType
              .VDW,
            { opacity: 0.65, color: "0x374151" },
            {}
          );
          if (selectedChain) {
            v.addSurface(
              ($3Dmol as unknown as { SurfaceType: { VDW: number } }).SurfaceType
                .VDW,
              { opacity: 0.85, color: "0x14b8a6" },
              { chain: selectedChain }
            );
          }
        }

        // ── Ligand PDBQT overlay ─────────────────────────────────────────────
        if (pdbqtContent) {
          const ligand = v.addModel(pdbqtContent, "pdbqt");
          // Target only the ligand model to avoid re-styling protein atoms.
          v.setStyle(
            { model: ligand as unknown as number },
            { stick: { colorscheme: "elementColors", radius: 0.2 } }
          );
        }

        // ── Docking box overlay ──────────────────────────────────────────────
        if (gridBox) {
          v.addBox({
            center: gridBox.center,
            // BoxSpec uses w/h/d for dimensions, not x/y/z
            dimensions: {
              w: gridBox.size.x,
              h: gridBox.size.y,
              d: gridBox.size.z,
            },
            color: "0x14b8a6",
            opacity: 0.15,
            wireframe: true,
          });
        }

        v.zoomTo();
        v.render();
      };

      if (pdbContent) {
        render(pdbContent);
      } else if (pdbId) {
        fetch(`https://files.rcsb.org/download/${pdbId.toUpperCase()}.pdb`)
          .then((r) => {
            if (!r.ok) throw new Error(`RCSB returned HTTP ${r.status}`);
            return r.text();
          })
          .then((text) => {
            if (!cancelled) render(text);
          })
          .catch((err) => {
            console.error("[ProteinViewer] fetch failed:", err);
          });
      }
    });

    return () => {
      cancelled = true;
      viewerRef.current?.clear();
      viewerRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
    // gridBox is an object — callers must memoize it to avoid reload on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdbId, pdbContent, pdbqtContent, selectedChain, gridBox, mode]);

  return (
    <div
      ref={containerRef}
      style={{
        height,
        width: "100%",
        borderRadius: "8px",
        border: "1px solid #1e2433",
        overflow: "hidden",
        position: "relative",
        backgroundColor: "#0f1117",
      }}
    />
  );
}
