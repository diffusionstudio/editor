/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { secondsToFrames } from "@diffusionstudio/runtime";

export const RULER_INTERVALS = [
  {
    numerator: secondsToFrames(600),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(300),
    denominator: 5,
  },
  {
    numerator: secondsToFrames(120),
    denominator: 4,
  },
  {
    numerator: secondsToFrames(60),
    denominator: 6,
  },
  {
    numerator: secondsToFrames(30),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(10),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(5),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(3),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(2),
    denominator: 10,
  },
  {
    numerator: secondsToFrames(1),
    denominator: 10,
  },
  {
    numerator: 15,
    denominator: 5,
  },
  {
    numerator: 10,
    denominator: 10,
  },
  {
    numerator: 5,
    denominator: 5,
  },
];

// window.getComputedStyle(document.body).getPropertyValue('--background')

export const COLORS = {
  background: {
    default: '#1C1C1C',
    muted: '#292929',
    accent: '#292929',
  },
  border: {
    darker: '#1C1C1C',
    input: '#3E3F41',
    ring: '#008CFF',
    scrubber: '#F43535', // ambient red
  },
  ruler: {
    tick: 'rgba(53, 53, 53, 1)',
    text: 'rgba(75, 75, 75, 1)',
  },
  clip: {
    group: {
      background: '#40464F',
      primary: '#545D67',
      foreground: '#EDF0F3',
    },
    video: {
      background: '#0F3C8A',
      primary: '#70A7FF', // Waveform
      foreground: '#CCE0FF', // Label
    },
    audio: {
      background: '#004732',
      primary: '#0DBF8A',
      foreground: '#CBFAED',
    },
    caption: {
      background: '#7B1E5A',
      primary: '#AA317B', // Word background
      foreground: '#F9DCED',
    },
    image: {
      background: '#A55912',
      foreground: '#F9F2EC',
    },
    text: {
      background: '#303E4F',
      foreground: '#E7EFF9',
    },
    shape: {
      background: '#933325',
      foreground: '#FAEDEB',
    },
    scene: {
      background: '#066284',
      primary: '#5AB9DD',
      foreground: '#DBEAF0',
    },
    clipPath: {
      background: '#5455DE',
      foreground: '#EAE8FC',
    },
    adjustment: {
      background: '#4827B0',
      foreground: '#E7DFFB',
    },
    html: {
      background: '#2B525F',
      foreground: '#E7F4F9',
    },
    failed: {
      background: '#2E1D1D',
      foreground: '#FF8A8A',
    },
  },
} as const;
