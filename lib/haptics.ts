/**
 * Haptics, where the platform has them. iOS Safari ignores `vibrate`, so the
 * events are still dispatched for CSS feedback and nothing throws.
 */
type Pattern = "tap" | "light" | "medium" | "heavy" | "success" | "warning" | "heart";
const PATTERNS: Record<Pattern, number | number[]> = {
  tap: 8,
  light: 12,
  medium: 18,
  heavy: [24],
  success: [12, 40, 12],
  warning: [30, 60, 30],
  heart: [10, 30, 10, 30, 16],
};

export function haptic(kind: Pattern = "tap") {
  if (typeof navigator === "undefined") return;
  // Respect the OS-level "reduce motion" veil as a proxy for "don't buzz me".
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  try { navigator.vibrate?.(PATTERNS[kind]); } catch { /* unsupported */ }
  try { window.dispatchEvent(new CustomEvent("bitchat-haptic", { detail: { kind } })); } catch { /* SSR */ }
}
