import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaType } from "@/types/chat";

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60 MB
export const STORAGE_BUCKET = "chat-media";

export interface MediaValidationError {
  message: string;
}

export function validateMediaFile(file: File): { type: MediaType } | { error: string } {
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");

  if (!isImage && !isVideo) {
    return { error: "Only images and videos are allowed." };
  }

  if (isImage && file.size > MAX_IMAGE_BYTES) {
    return { error: "Images must be 12 MB or smaller." };
  }

  if (isVideo && file.size > MAX_VIDEO_BYTES) {
    return { error: "Videos must be 60 MB or smaller." };
  }

  if (isImage && file.size === 0) {
    return { error: "That image is empty." };
  }

  return { type: isImage ? "image" : "video" };
}

export function extensionFor(file: File, type: MediaType): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,8}$/.test(fromName)) return fromName;
  return type === "image" ? "jpg" : "mp4";
}

export async function uploadMedia(
  client: SupabaseClient,
  file: File,
  userId: string,
  type: MediaType,
): Promise<{ url: string } | { error: string }> {
  const ext = extensionFor(file, type);
  const path = `${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error } = await client.storage.from(STORAGE_BUCKET).upload(path, file, {
    contentType: file.type || (type === "image" ? "image/jpeg" : "video/mp4"),
    cacheControl: "31536000",
    upsert: false,
  });

  if (error) {
    return { error: "Upload failed — the file could not be saved. Please try again." };
  }

  const { data } = client.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isProbablyImage(url: string | null | undefined, type: MediaType | null | undefined): boolean {
  if (type === "image") return true;
  if (type === "video") return false;
  return Boolean(url && /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(url));
}
