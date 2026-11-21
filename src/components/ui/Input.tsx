"use client";

import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";

const FIELD_BASE =
  "w-full rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 text-[15px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]/70 focus:bg-[var(--panel-2)] disabled:opacity-50";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  icon?: ReactNode;
  error?: string | null;
}

export const Input = forwardRef<HTMLInputElement, FieldProps>(function Input(
  { label, hint, icon, error, className = "", id, ...rest },
  ref,
) {
  const inputId = id || rest.name || label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <label className="block" htmlFor={inputId}>
      {label && (
        <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
          {label}
        </span>
      )}
      <span className="relative block">
        {icon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          {...rest}
          className={`${FIELD_BASE} h-12 ${icon ? "pl-11" : ""} ${
            error ? "border-[var(--danger)]/60" : ""
          } ${className}`}
        />
      </span>
      {error ? (
        <span className="mt-1.5 block px-1 text-[12.5px] font-medium text-[var(--danger)]">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block px-1 text-[12px] text-[var(--text-faint)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, hint, className = "", id, ...rest }, ref) {
    const inputId = id || rest.name || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <label className="block" htmlFor={inputId}>
        {label && (
          <span className="mb-1.5 block px-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
            {label}
          </span>
        )}
        <textarea
          ref={ref}
          id={inputId}
          {...rest}
          className={`${FIELD_BASE} thin-scrollbar min-h-24 resize-none py-3 leading-relaxed ${className}`}
        />
        {hint && (
          <span className="mt-1.5 block px-1 text-[12px] text-[var(--text-faint)]">
            {hint}
          </span>
        )}
      </label>
    );
  },
);
