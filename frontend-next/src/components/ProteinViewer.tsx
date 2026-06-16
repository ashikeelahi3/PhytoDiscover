"use client";

import { useEffect, useRef, useState } from "react";
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<GLViewer | null>(null);
  const pdbTextRef = useRef<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chainColor, setChainColor] = useState("#14b8a6");
  const [baseColor, setBaseColor] = useState("#374151");
  const [bgColor, setBgColor] = useState("#0f1117");

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      wrapperRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const downloadPng = () => {
    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${pdbId ?? "protein"}${selectedChain ? `_${selectedChain}` : ""}.png`;
    a.click();
  };

  const downloadPdb = () => {
    const text = pdbTextRef.current;
    if (!text) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `${pdbId ?? "protein"}${selectedChain ? `_${selectedChain}` : ""}.pdb`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

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
      }).createViewer(containerRef.current, { backgroundColor: bgColor.replace("#", "0x") });

      viewerRef.current = viewer;

      const render = (proteinPdb: string) => {
        if (cancelled || !viewerRef.current) return;
        const v = viewerRef.current;
        v.clear();

        // ── Protein model ────────────────────────────────────────────────────
        v.addModel(proteinPdb, "pdb");

        const hex3dmol = chainColor.replace("#", "0x");
        const baseHex = baseColor.replace("#", "0x");
        if (mode === "cartoon") {
          v.setStyle({}, { cartoon: { color: baseHex } });
          if (selectedChain) {
            v.setStyle(
              { chain: selectedChain },
              { cartoon: { color: hex3dmol } }
            );
          }
        } else if (mode === "stick") {
          v.setStyle({}, { stick: { colorscheme: "elementColors" } });
        } else {
          v.setStyle({}, { cartoon: { color: baseHex, opacity: 0.15 } });
          v.addSurface(
            ($3Dmol as unknown as { SurfaceType: { VDW: number } }).SurfaceType
              .VDW,
            { opacity: 0.65, color: baseHex },
            {}
          );
          if (selectedChain) {
            v.addSurface(
              ($3Dmol as unknown as { SurfaceType: { VDW: number } }).SurfaceType
                .VDW,
              { opacity: 0.85, color: hex3dmol },
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
        pdbTextRef.current = pdbContent;
        render(pdbContent);
      } else if (pdbId) {
        fetch(`https://files.rcsb.org/download/${pdbId.toUpperCase()}.pdb`)
          .then((r) => {
            if (!r.ok) throw new Error(`RCSB returned HTTP ${r.status}`);
            return r.text();
          })
          .then((text) => {
            if (!cancelled) { pdbTextRef.current = text; render(text); }
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
  }, [pdbId, pdbContent, pdbqtContent, selectedChain, gridBox, mode, chainColor, baseColor, bgColor]);

  const btnStyle: React.CSSProperties = {
    background: "rgba(15,17,23,0.7)",
    border: "1px solid #1e2433",
    borderRadius: 6,
    color: "#9ca3af",
    cursor: "pointer",
    padding: "4px 6px",
    lineHeight: 1,
    fontSize: 12,
  };

  return (
    <div
      ref={wrapperRef}
      style={{
        height: isFullscreen ? "100vh" : height,
        width: "100%",
        borderRadius: "8px",
        border: "1px solid #1e2433",
        overflow: "hidden",
        position: "relative",
        backgroundColor: bgColor,
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4, zIndex: 10 }}>
        <input
          type="color"
          value={bgColor}
          onChange={(e) => setBgColor(e.target.value)}
          title="Background colour"
          style={{ ...btnStyle, padding: 2, width: 28, height: 26, cursor: "pointer" }}
        />
        <input
          type="color"
          value={baseColor}
          onChange={(e) => setBaseColor(e.target.value)}
          title="Protein colour"
          style={{ ...btnStyle, padding: 2, width: 28, height: 26, cursor: "pointer" }}
        />
        {selectedChain && (
          <input
            type="color"
            value={chainColor}
            onChange={(e) => setChainColor(e.target.value)}
            title="Chain colour"
            style={{
              ...btnStyle,
              padding: 2,
              width: 28,
              height: 26,
              cursor: "pointer",
            }}
          />
        )}
        {(pdbId || pdbContent) && (
          <>
            <button
              onClick={downloadPng}
              title="Download PNG"
              style={btnStyle}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#14b8a6")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
            >
              ⬇ PNG
            </button>
            <button
              onClick={downloadPdb}
              title="Download PDB"
              style={btnStyle}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#14b8a6")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
            >
              ⬇ PDB
            </button>
          </>
        )}
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          style={btnStyle}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#14b8a6")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#9ca3af")}
        >
          ⛶
        </button>
      </div>
    </div>
  );
}
