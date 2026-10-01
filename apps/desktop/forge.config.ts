/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch } from 'node:os';
import { dirname, join } from 'node:path';

import type { ForgeConfig } from '@electron-forge/shared-types';
import type { MakerSquirrelConfig } from '@electron-forge/maker-squirrel';

const { version } = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));


const sign = windowsSign();

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Diffusion Studio',
    appBundleId: 'studio.diffusion.editor',
    appCategoryType: 'public.app-category.video',
    appVersion: version,
    icon: './assets/icon',
    win32metadata: {
      CompanyName: 'Diffusion Studio',
      ProductName: 'Diffusion Studio',
      FileDescription: 'Diffusion Studio',
      'application-manifest': join(__dirname, 'assets', 'app.manifest'),
    },
    protocols: [{ name: 'Diffusion Studio', schemes: ['diffusion'] }],
    prune: false,
    ignore: (path) =>
      path !== '' &&
      path !== '/package.json' &&
      path !== '/dist' &&
      !path.startsWith('/dist/') &&
      path !== '/web' &&
      !path.startsWith('/web/'),
    // Staged by scripts/stage-{cli,runtime,docs}.mjs; end up at
    // Contents/Resources/{cli,runtime,docs}.
    extraResource: ['./cli', './runtime', './docs'],
    osxSign: process.env.SKIP_SIGN ? undefined : {},
    osxNotarize:
      process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
        ? {
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_PASSWORD,
          teamId: process.env.APPLE_TEAM_ID,
        }
        : undefined,
    windowsSign: sign,
  },
  makers: [
    new MakerZIP({}, ['darwin']),
    new MakerSquirrel({
      name: 'DiffusionStudio',
      authors: 'Diffusion Studio',
      description: 'The professional video editor built for agents',
      exe: 'Diffusion Studio.exe',
      setupExe: `Diffusion-Studio-${process.arch}-Setup.exe`,
      setupIcon: './assets/icon.ico',
      loadingGif: './assets/install-spinner.gif',
      // Shown by Add/Remove Programs; Squirrel only takes a URL.
      iconUrl: 'https://raw.githubusercontent.com/diffusionstudio/editor/main/apps/desktop/assets/icon.ico',
      noMsi: true,
      windowsSign: sign,
    }),
    new MakerDMG({
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
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: 'diffusionstudio', name: 'editor' },
      draft: true,
    }),
  ],
  hooks: {
    prePackage: async () => {
      if (process.platform === 'win32' && !process.env.SKIP_SIGN && !sign) {
        throw new Error(
          'Windows signing needs WINDOWS_SIGNTOOL_PATH, WINDOWS_SIGN_DLIB and WINDOWS_SIGN_METADATA; set SKIP_SIGN=1 for an unsigned build.',
        );
      }
    },
    preMake: async () => ensure7zip(),
  },
};



function windowsSign() {
  if (process.platform !== 'win32' || process.env.SKIP_SIGN) {
    return undefined;
  }

  const {
    WINDOWS_SIGNTOOL_PATH: signToolPath,
    WINDOWS_SIGN_DLIB: dlib,
    WINDOWS_SIGN_METADATA: metadata
  } = process.env;

  if (!signToolPath || !dlib || !metadata) {
    return undefined;
  }

  return {
    signToolPath,
    automaticallySelectCertificate: false,
    signWithParams: ['/dlib', dlib, '/dmdf', metadata],
    timestampServer: 'http://timestamp.acs.microsoft.com',
    hashes: ['sha256'],
  } as unknown as MakerSquirrelConfig;
}

function ensure7zip() {
  if (process.platform !== 'win32') return;
  const require = createRequire(__filename);
  const winstaller = require.resolve('electron-winstaller/package.json', {
    paths: [dirname(require.resolve('@electron-forge/maker-squirrel/package.json'))],
  });
  const vendor = join(dirname(winstaller), 'vendor');
  for (const ext of ['exe', 'dll']) {
    const target = join(vendor, `7z.${ext}`);
    if (!existsSync(target)) copyFileSync(join(vendor, `7z-${arch()}.${ext}`), target);
  }
}

export default config;
