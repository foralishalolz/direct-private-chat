"use client";

import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
type Size = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "accent-gradient text-white shadow-[0_10px_30px_-12px_var(--accent-glow)] hover:brightness-110",
  secondary:
    "border border-[var(--border-strong)] bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--panel-3)]",
  ghost: "text-[var(--text-soft)] hover:bg-[var(--panel-2)]",
  danger:
    "border border-[var(--danger)]/30 bg-[var(--danger)]/12 text-[var(--danger)] hover:bg-[var(--danger)]/18",
  soft: "bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)]/20",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-[13px] rounded-full gap-1.5",
  md: "h-11 px-5 text-[14px] rounded-full gap-2",
  lg: "h-12 px-6 text-[15px] rounded-2xl gap-2",
  icon: "size-10 rounded-full",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  fullWidth,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`press inline-flex items-center justify-center font-semibold tracking-tight transition focus-ring disabled:opacity-45 ${
        VARIANTS[variant]
      } ${SIZES[size]} ${fullWidth ? "w-full" : ""} ${className}`}
    >
      {loading ? (
        <LoaderCircle className="size-4 animate-spin" strokeWidth={2.2} />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
