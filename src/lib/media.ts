"use client";

import { CHAT_MEDIA_BUCKET, supabase } from "@/lib/supabase";

export interface UploadResult {
  url: string;
  path: string;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
}

const IMAGE_MAX_BYTES = 15 * 1024 * 1024; // 15 MB before compression
const VIDEO_MAX_BYTES = 50 * 1024 * 1024; // matches the bucket limit
const TARGET_IMAGE_EDGE = 1600;

export class UploadError extends Error {}

/** Draw an image to a canvas and export a compressed JPEG/WebP blob. */
async function compressImage(
  file: File,
  maxEdge = TARGET_IMAGE_EDGE,
  quality = 0.82,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new UploadError("Could not process that image.");

  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const supportsWebp = canvas
    .toDataURL("image/webp")
    .startsWith("data:image/webp");

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      resolve,
      supportsWebp ? "image/webp" : "image/jpeg",
      quality,
    );
  });

  if (!blob) throw new UploadError("Could not process that image.");

  return { blob, width, height };
}

/**
 * Downscale a video a little via a poster fallback is not possible in-browser;
 * instead we validate size and let the bucket cap it. GIFs are left untouched
 * so animation survives.
 */
export async function uploadMedia(
  file: File,
  options: { groupId: string; userId: string },
): Promise<UploadResult> {
  if (!supabase) throw new UploadError("Chat is not configured.");

  const mimeType = file.type || "application/octet-stream";
  const isImage = mimeType.startsWith("image/");
  const isVideo = mimeType.startsWith("video/");
  const isAudio = mimeType.startsWith("audio/");

  if (!isImage && !isVideo && !isAudio) {
    throw new UploadError("Only photos, videos and voice notes can be sent.");
  }

  if (isImage && file.size > IMAGE_MAX_BYTES) {
    throw new UploadError("That photo is too large (max 15 MB).");
  }
  if (isVideo && file.size > VIDEO_MAX_BYTES) {
    throw new UploadError("That video is too large (max 50 MB).");
  }

  let uploadBlob: Blob = file;
  let width: number | undefined;
  let height: number | undefined;
  let extension = file.name.split(".").pop()?.toLowerCase() || "bin";

  // Compress still images — big camera photos turn into ~200KB webp files,
  // which makes sending photos painless on a slow mobile connection.
  if (isImage && mimeType !== "image/gif") {
    try {
      const compressed = await compressImage(file);
      uploadBlob = compressed.blob;
      width = compressed.width;
      height = compressed.height;
      extension = compressed.blob.type.includes("webp") ? "webp" : "jpg";
    } catch {
      // Fall back to the original file if the browser can't decode it.
      uploadBlob = file;
    }
  }

  const path = `${options.groupId}/${options.userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`;

  const { error } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(path, uploadBlob, {
      cacheControl: "31536000",
      contentType: uploadBlob.type || mimeType,
      upsert: false,
    });

  if (error) {
    throw new UploadError(
      error.message.includes("Bucket not found")
        ? "Media storage isn't set up yet — run the updated supabase/setup.sql."
        : "Upload failed. Check your connection and try again.",
    );
  }

  const { data } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);

  return {
    url: data.publicUrl,
    path,
    mimeType: uploadBlob.type || mimeType,
    bytes: uploadBlob.size,
    width,
    height,
  };
}

export async function deleteMedia(path: string): Promise<void> {
  if (!supabase) return;
  await supabase.storage.from(CHAT_MEDIA_BUCKET).remove([path]);
}

export function mediaKindFor(mimeType: string): "image" | "video" | "audio" {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "image";
}

/** Quick client-side sniff so we can reject nonsense before uploading. */
export function isSupportedMedia(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    file.type.startsWith("video/") ||
    file.type.startsWith("audio/")
  );
}
