/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AIFF_MIME } from '@diffusionstudio/assets';

/**
 * Converts a MIME type to its corresponding file extension
 * @param mimeType - The MIME type to convert (e.g., "image/jpeg" or "text/plain; charset=utf-8")
 * @returns The file extension with leading dot (e.g., ".jpg") or null if not found
 */
export function mimeTypeToExtension(mimeType: string): string {
  // Normalize the MIME type to lowercase and extract main type (before semicolon)
  const normalizedMimeType = mimeType.toLowerCase().trim().split(';')[0].trim();

  const mimeToExtMap: Record<string, string> = {
    // Images
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
    'image/avif': '.avif',
    'image/heic': '.heic',
    'image/heif': '.heif',

    // Documents
    'application/pdf': '.pdf',
    'text/plain': '.txt',

    // Audio
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    [AIFF_MIME]: '.aiff',
    'audio/wav': '.wav',
    'audio/wave': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/aac': '.aac',
    'audio/m4a': '.m4a',
    'audio/flac': '.flac',
    'audio/webm': '.webm',

    // Video
    'video/mp4': '.mp4',
    'video/mpeg': '.mpeg',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
    'video/3gpp': '.3gp',
    'video/x-flv': '.flv',
    'video/x-ms-wmv': '.wmv',

    // Web files
    'text/html': '.html',
    'text/javascript': '.js',
    'application/javascript': '.js',
    'application/json': '.json',
    'application/x-subrip': '.srt',
    'text/vtt': '.vtt',
    'text/xml': '.xml',
    'application/xml': '.xml',
  };

  return mimeToExtMap[normalizedMimeType] || '.bin';
}

/**
 * Returns a file name without its final extension.
 * @param name - File name
 * @returns File name without extension
 */
export function stripExtension(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0) return name;
  return name.slice(0, dotIndex);
}
