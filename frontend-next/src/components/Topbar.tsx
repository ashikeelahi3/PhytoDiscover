"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getWorkers } from "@/lib/api";
import { useSession } from "@/contexts/SessionContext";

const PAGE_TITLES: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Search Compounds",
    description: "Find phytochemicals from the plant compound database",
  },
  "/smiles": {
    title: "Custom SMILES",
    description: "Validate and add compounds by SMILES string",
  },
  "/docking": {
    title: "Configure Docking",
    description: "Select a protein target and launch molecular docking",
  },
  "/queue": {
    title: "Job Queue",
    description: "Monitor running and completed docking jobs",
  },
  "/results": {
    title: "View Results",
    description: "Explore binding affinity scores and poses",
  },
};

export function Topbar() {
  const pathname = usePathname();
  const { session } = useSession();

  const { data: workers } = useQuery({
    queryKey: ["workers"],
    queryFn: getWorkers,
    refetchInterval: 30_000,
  });

  const pageKey = Object.keys(PAGE_TITLES).find((k) =>
    k === "/" ? pathname === "/" : pathname.startsWith(k)
  );
  const page = pageKey ? PAGE_TITLES[pageKey] : null;

  const onlineCount = workers?.total_online ?? 0;
  const workersOnline = onlineCount > 0;

  const sessionSuffix = session
    ? `…${session.session_id.slice(-6)}`
    : "loading";

  return (
    <header className="sticky top-0 z-30 h-14 bg-[#161b27]/90 backdrop-blur border-b border-[#1e2433] flex items-center justify-between px-6 gap-4 shrink-0">
      <div className="min-w-0">
        {page ? (
          <div className="flex items-baseline gap-3 min-w-0">
            <h1 className="text-sm font-semibold text-[#f1f5f9] whitespace-nowrap">
              {page.title}
            </h1>
            <span className="text-xs text-[#64748b] truncate hidden sm:block">
              {page.description}
            </span>
          </div>
        ) : (
          <h1 className="text-sm font-semibold text-[#f1f5f9]">PhytoDiscover</h1>
        )}
      </div>

      <div className="flex items-center gap-4 shrink-0">
        {/* Worker status */}
        <div className="flex items-center gap-1.5 text-xs">
          <span
            className={`w-2 h-2 rounded-full ${workersOnline ? "bg-green-400" : "bg-red-400"}`}
          />
          <span className={workersOnline ? "text-green-400" : "text-red-400"}>
            {workers === undefined
              ? "Checking workers…"
              : workersOnline
                ? `${onlineCount} worker${onlineCount !== 1 ? "s" : ""} online`
                : "No workers online"}
          </span>
        </div>

        {/* Session ID */}
        <span className="text-xs text-[#64748b] font-mono hidden md:block">
          {sessionSuffix}
        </span>
      </div>
    </header>
  );
}
