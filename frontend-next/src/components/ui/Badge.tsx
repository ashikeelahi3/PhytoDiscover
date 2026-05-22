import type { ReactNode } from "react";
import type { JobStatus } from "@/lib/types";

type Variant = "teal" | "green" | "yellow" | "red" | "gray" | "blue";

interface BadgeProps {
  variant?: Variant;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<Variant, string> = {
  teal: "bg-[#14b8a6]/15 text-[#14b8a6] border-[#14b8a6]/30",
  green: "bg-green-500/15 text-green-400 border-green-500/30",
  yellow: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  red: "bg-red-500/15 text-red-400 border-red-500/30",
  gray: "bg-[#1e2433] text-[#64748b] border-[#1e2433]",
  blue: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

export function Badge({ variant = "gray", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border font-mono ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; variant: Variant }> = {
    pending: { label: "Pending", variant: "gray" },
    preparing: { label: "Preparing", variant: "blue" },
    docking: { label: "Docking", variant: "yellow" },
    parsing: { label: "Parsing", variant: "yellow" },
    done: { label: "Done", variant: "green" },
    failed: { label: "Failed", variant: "red" },
  };

  const { label, variant } = map[status] ?? { label: status, variant: "gray" };
  return <Badge variant={variant}>{label}</Badge>;
}
