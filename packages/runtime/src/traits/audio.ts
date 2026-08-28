/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from '@diffusionstudio/koota';

// Audio volume in decibels (0 dB = unity, -Infinity = silence).
export const Volume = trait({ value: 0 });

// Presence means muted.
export const Muted = trait();

// Runtime-only solo tag (not serialized).
export const Soloed = trait();

// Runtime-only: maps timeline time to AudioContext time while playing.
export const AudioPlayback = trait({
	wasPlaying: false,
	contextOffsetInSeconds: 0,
	timelineOffsetInSeconds: 0,
});
