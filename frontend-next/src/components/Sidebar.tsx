"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useSession } from "@/contexts/SessionContext";

const NAV_ITEMS = [
  { href: "/", label: "Search Compounds", step: 1 },
  { href: "/smiles", label: "Custom SMILES", step: 2 },
  { href: "/docking", label: "Configure Docking", step: 3 },
  { href: "/queue", label: "Job Queue", step: 4 },
  { href: "/results", label: "View Results", step: 5 },
];

export function Sidebar() {
  const pathname = usePathname();
  const { session, setDisplayName } = useSession();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(session?.display_name ?? "Researcher");
    setEditing(true);
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commitEdit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== session?.display_name) {
      await setDisplayName(trimmed).catch(() => {});
    }
    setEditing(false);
  }

  const currentStep =
    NAV_ITEMS.find((n) =>
      n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)
    )?.step ?? 0;

  return (
    <aside className="fixed left-0 top-0 h-full w-[220px] bg-[#161b27] border-r border-[#1e2433] flex flex-col z-40">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-[#1e2433]">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span className="text-[#14b8a6] text-lg">⬡</span>
          <span className="font-semibold text-[#f1f5f9] text-sm tracking-wide">
            PhytoDiscover
          </span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, step }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors no-underline ${
                active
                  ? "text-[#14b8a6] border-l-2 border-[#14b8a6] bg-[#14b8a6]/5"
                  : "text-[#94a3b8] border-l-2 border-transparent hover:text-[#f1f5f9] hover:bg-[#1e2433]/50"
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                  step < currentStep
                    ? "bg-[#14b8a6] text-[#0f1117]"
                    : active
                      ? "bg-[#14b8a6] text-[#0f1117]"
                      : "bg-[#1e2433] text-[#64748b]"
                }`}
              >
                {step < currentStep ? "✓" : step}
              </span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Session name */}
      <div className="px-4 py-4 border-t border-[#1e2433]">
        <p className="text-[10px] text-[#64748b] uppercase tracking-wider mb-1">
          Session
        </p>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full bg-[#0f1117] border border-[#14b8a6] rounded px-2 py-1 text-xs text-[#f1f5f9] outline-none font-mono"
          />
        ) : (
          <button
            onClick={startEdit}
            title="Click to rename"
            className="w-full text-left text-xs text-[#94a3b8] hover:text-[#14b8a6] truncate font-mono cursor-pointer bg-transparent border-none p-0"
          >
            {session?.display_name ?? "Researcher"}
          </button>
        )}
      </div>
    </aside>
  );
}
