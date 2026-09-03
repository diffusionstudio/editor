/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ContainerFormat } from './types';

/**
 * Lazily imports the output format based on the format specified.
 *
 * `fastStart` is the ISOBMFF option the target dictates (see `TargetBuffer`);
 * it is nothing to a query of what the container supports, so it is optional.
 */
export async function createOutputFormat(
  format?: ContainerFormat,
  options?: { fastStart?: false | 'in-memory' },
) {
  if (format == 'webm') {
    const { WebMOutputFormat } = await import('mediabunny');
    return new WebMOutputFormat();
  } else if (format == 'ogg') {
    const { OggOutputFormat } = await import('mediabunny');
    return new OggOutputFormat();
  } else if (format == 'mov') {
    const { MovOutputFormat } = await import('mediabunny');
    return new MovOutputFormat();
  } else {
    const { Mp4OutputFormat } = await import('mediabunny');
    return new Mp4OutputFormat({ fastStart: options?.fastStart ?? false });
  }
}
