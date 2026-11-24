export type Point = [x: number, y: number];
export type Stroke = { id: string; by: string; color: string; width: number; points: Point[]; brush?: "pen" | "glow" };
export type BoardEdit = { stroke: Stroke | null; version: number };

/** Overlay unsaved stroke edits on the latest server snapshot. */
export function mergeBoard(base: Stroke[], pending: ReadonlyMap<string, BoardEdit>): Stroke[] {
  const result = base.filter(stroke => !pending.has(stroke.id));
  for (const { stroke } of pending.values()) if (stroke) result.push(stroke);
  return result;
}
