import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-[#14b8a6] text-[#0f1117] font-semibold hover:bg-[#0d9488] disabled:bg-[#1e2433] disabled:text-[#64748b]",
  secondary:
    "bg-[#1e2433] text-[#f1f5f9] hover:bg-[#252d3d] disabled:opacity-40",
  ghost:
    "bg-transparent text-[#f1f5f9] hover:bg-[#1e2433] disabled:opacity-40",
  danger:
    "bg-[#ef4444] text-white font-semibold hover:bg-[#dc2626] disabled:opacity-40",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded border border-[#1e2433] cursor-pointer transition-colors duration-150 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
