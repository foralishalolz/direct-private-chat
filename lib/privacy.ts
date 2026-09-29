export type PrivacySettings = {
  share_online: boolean;
  share_last_active: boolean;
  share_typing: boolean;
  share_receipts: boolean;
};

export type PrivacySnapshot = PrivacySettings & { revision: number };

export const DEFAULT_PRIVACY: PrivacySettings = {
  share_online: true,
  share_last_active: true,
  share_typing: true,
  share_receipts: true,
};

// HTTP responses and realtime events may arrive in a different order.
export function reconcilePrivacy(current: PrivacySnapshot | null, value: unknown): PrivacySnapshot | null {
  if (!value || typeof value !== "object") return current;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.revision) || (row.revision as number) < 0) return current;
  if (Object.keys(DEFAULT_PRIVACY).some(key => typeof row[key] !== "boolean")) return current;
  if (current && (row.revision as number) <= current.revision) return current;
  return {
    revision: row.revision as number,
    share_online: row.share_online as boolean,
    share_last_active: row.share_last_active as boolean,
    share_typing: row.share_typing as boolean,
    share_receipts: row.share_receipts as boolean,
  };
}
