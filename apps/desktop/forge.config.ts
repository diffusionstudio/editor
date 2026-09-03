/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb, type MakerDebConfig } from '@electron-forge/maker-deb';
import MakerAppImage, { type MakerAppImageConfig } from '@reforged/maker-appimage';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerRpm, type MakerRpmConfig } from '@electron-forge/maker-rpm';
import { MakerZIP } from '@electron-forge/maker-zip';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { version } = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));

// electron-packager derives the executable name from `name` and keeps the space
// in it, which is fine inside a .app bundle but not for a binary on $PATH. The
// deb and rpm packages symlink this into /usr/bin and the staged CLI wrapper
// execs it, so both sides agree on the lowercase form.
const LINUX_EXECUTABLE = 'diffusion-studio';

// FreeDesktop metadata shared by every Linux artifact. The mime type is what
// registers `diffusion://` with xdg, so the auth and checkout deep links reach
// the app the same way the macOS bundle's protocol handler does — for the
// AppImage only once its desktop file is integrated (by the desktop
// environment's prompt, or AppImageLauncher).
const linuxDesktop = {
  name: LINUX_EXECUTABLE,
  // What lands in the desktop entry's `Exec`, and the file the AppImage maker
  // looks for inside the packaged tree. Both default to the sanitized
  // package name (`diffusionstudio-desktop`), which is not what is packaged.
  bin: LINUX_EXECUTABLE,
  productName: 'Diffusion Studio',
  genericName: 'Video Editor',
  keywords: ['video', 'editor', 'agent'],
  icon: './assets/icon.png',
  categories: ['AudioVideo', 'Video'],
  mimeType: ['x-scheme-handler/diffusion'],
} satisfies NonNullable<MakerAppImageConfig['options']>;

// deb and rpm carry package metadata the desktop entry has no field for.
const linuxPackage = {
  ...linuxDesktop,
  description: 'Edit videos with coding agents, and refine any output in a full editing environment',
  homepage: 'https://diffusion.studio',
} satisfies NonNullable<MakerDebConfig['options']> & NonNullable<MakerRpmConfig['options']>;

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Diffusion Studio',
    // Only Linux renames the binary; on macOS it stays inside the bundle as
    // `Contents/MacOS/Diffusion Studio`, which the staged CLI wrapper and the
    // signing pass both address by that name. Read from the build host, since
    // that is what packages a platform here — cross-packaging Linux from macOS
    // would have to set it.
    executableName: process.platform === 'linux' ? LINUX_EXECUTABLE : undefined,
    appBundleId: 'studio.diffusion.editor',
    appCategoryType: 'public.app-category.video',
    appVersion: version,
    icon: './assets/icon',
    protocols: [{ name: 'Diffusion Studio', schemes: ['diffusion'] }],
    prune: false,
    ignore: (path) =>
      path !== '' &&
      path !== '/package.json' &&
      path !== '/dist' &&
      !path.startsWith('/dist/') &&
      path !== '/web' &&
      !path.startsWith('/web/'),
    // Staged by scripts/stage-{cli,docs,skills}.mjs; end up at
    // Contents/Resources/{cli,docs,skills} on macOS and resources/{...} on Linux.
    extraResource: ['./cli', './docs', './skills'],
    osxSign: process.env.SKIP_SIGN ? undefined : {},
    osxNotarize:
      process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
        ? {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          }
        : undefined,
  },
  makers: [
    new MakerZIP({}, ['darwin', 'linux']),
    new MakerDMG(
      {
        name: `Diffusion-Studio-${process.arch}`,
        icon: './assets/icon.icns',
        // Dark, on-brand window; @2x sibling is picked up automatically for retina.
        background: './assets/dmg-background.png',
        iconSize: 120,
        additionalDMGOptions: {
          'background-color': '#1c1c1c',
          window: { size: { width: 658, height: 498 } },
        },
        contents: (opts) => [
          { x: 188, y: 217, type: 'file', path: opts.appPath },
          { x: 470, y: 217, type: 'link', path: '/Applications' },
        ],
      },
      ['darwin'],
    ),
    new MakerDeb({ options: linuxPackage }, ['linux']),
    new MakerRpm({ options: linuxPackage }, ['linux']),
    // The format that runs on a distribution the deb and rpm do not cover:
    // one file, no root, no package manager. Needs `mksquashfs` on the build
    // host (squashfs-tools).
    new MakerAppImage({ options: linuxDesktop }, ['linux']),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: 'diffusionstudio', name: 'editor' },
      draft: true,
    }),
  ],
};

export default config;
