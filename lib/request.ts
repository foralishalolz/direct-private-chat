/** Retain request deadlines and cancellation on older iOS browsers without AbortSignal.any. */
export function requestSignal(parent?: AbortSignal | null, timeoutMs = 30000): AbortSignal {
  let deadline: AbortSignal;
  if (typeof AbortSignal.timeout === "function") deadline = AbortSignal.timeout(timeoutMs);
  else {
    const controller = new AbortController(); deadline = controller.signal;
    setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  }
  if (!parent) return deadline;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([parent, deadline]);
  if (parent.aborted) return parent;
  const controller = new AbortController(), signals = [parent, deadline];
  const abort = () => {
    const source = signals.find(signal => signal.aborted);
    controller.abort(source?.reason);
    for (const signal of signals) signal.removeEventListener("abort", abort);
  };
  for (const signal of signals) signal.addEventListener("abort", abort, { once: true });
  if (signals.some(signal => signal.aborted)) abort();
  return controller.signal;
}
