import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string | number | null | undefined;
  icon?: ReactNode;
  className?: string;
}

export function StatCard({ label, value, icon, className = "" }: StatCardProps) {
  return (
    <div
      className={`bg-[#161b27] border border-[#1e2433] rounded-lg p-4 flex flex-col gap-2 ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#64748b] uppercase tracking-wider">
          {label}
        </span>
        {icon && <span className="text-[#14b8a6]">{icon}</span>}
      </div>
      <span className="font-mono text-2xl font-semibold text-[#f1f5f9]">
        {value ?? "—"}
      </span>
    </div>
  );
}
