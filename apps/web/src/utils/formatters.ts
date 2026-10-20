/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AIFF_MIME } from "@diffusionstudio/assets";

/**
 * Formats a byte count to a human-readable size using base-1024 units.
 * @param bytes - Raw byte size.
 * @returns Formatted size string (e.g. "1.2 MB").
 */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const base = 1024;
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(base)),
  );
  const value = bytes / Math.pow(base, exponent);
  const decimals = exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[exponent]}`;
}

/**
 * Computes the greatest common divisor of two integers.
 * @param a - First value.
 * @param b - Second value.
 * @returns Greatest common divisor.
 */
function gcd(a: number, b: number) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/**
 * Formats width/height to a reduced aspect ratio string.
 * @param width - Pixel width.
 * @param height - Pixel height.
 * @returns Ratio in `W:H` format.
 */
export function formatAspectRatio(width: number, height: number) {
  const d = gcd(width, height);
  if (!d) return `${width}:${height}`;
  return `${Math.round(width / d)}:${Math.round(height / d)}`;
}

/**
 * Converts MIME types into friendlier display labels.
 * Falls back to the raw MIME type when unknown.
 * @param mimeType - MIME type value.
 * @returns Display label for the MIME type.
 */
export function formatMimeTypeLabel(mimeType: string) {
  mimeType = mimeType.split(';')[0].trim();

  const mapping: Record<string, string> = {
    "video/mp4": "MPEG-4 Movie",
    "video/quicktime": "QuickTime Movie",
    "video/webm": "WebM Video",
    "audio/mpeg": "MP3 Audio",
    "audio/wav": "WAV Audio",
    [AIFF_MIME]: "AIFF Audio",
    "image/jpeg": "JPEG Image",
    "image/png": "PNG Image",
    "image/webp": "WebP Image",
  };

  return mapping[mimeType] ?? mimeType;
}

/**
 * Formats seconds to `MM:SS` or `HH:MM:SS`.
 * @param seconds - Duration in seconds.
 * @returns Timecode string.
 */
export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00";

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remaining = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${remaining
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Formats audio channel count to a friendly label.
 * @param channels - Channel count.
 * @returns Channel label or placeholder when unavailable.
 */
export function formatChannels(channels: number | undefined) {
  if (!channels) return null;
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  return `${channels} ch`;
}

/**
 * Formats asset timestamps for metadata display.
 * Uses "Today, HH:MM" when date matches current local day.
 * @param value - Date-like input.
 * @returns Formatted date/time label or placeholder when invalid.
 */
export function formatAssetDate(value: string | number | null | undefined) {
  if (value == null) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (isSameDay) return `Today, ${time}`;

  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return `${datePart}, ${time}`;
}
