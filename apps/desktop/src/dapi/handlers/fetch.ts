/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { spawn, spawnSync } from "node:child_process";
import { DapiError } from "@diffusionstudio/dapi";

import type { MainHandler } from "../handler";

// Resolve the binary once. YT_DLP_PATH is an escape hatch for pinned or
// non-PATH installs.
const BIN = process.env.YT_DLP_PATH ?? "yt-dlp";

// Fails with an actionable message before any download is attempted. ENOENT is
// the "not installed" case; a non-zero status means the binary is present but
// broken.
function assertInstalled(): void {
  const probe = spawnSync(BIN, ["--version"], { encoding: "utf8" });
  if (probe.error) {
    if ((probe.error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new DapiError(
        "unsupported",
        "yt-dlp not found. Install it (brew install yt-dlp, or pipx install yt-dlp) or set YT_DLP_PATH to its location.",
      );
    }
    throw probe.error;
  }
  if (probe.status !== 0) {
    throw new DapiError("unsupported", probe.stderr?.trim() || "yt-dlp is present but not runnable.");
  }
}

// yt-dlp's own `after_move:filepath` reports what actually landed (post
// extraction / rename), so the name is never guessed. --quiet keeps stdout to
// those paths; stderr is kept only for the error line when it fails.
export const fetchVideo: MainHandler<"fetch"> = ({ url, output, format, audio, raw }, ctx) => {
  assertInstalled();

  const args = ["--quiet", "--no-warnings", "--print", "after_move:filepath"];
  if (output) args.push("-o", output);
  if (format) {
    args.push("-f", format);
  } else if (!audio) {
    // Default to mp4: prefer mp4/m4a streams, then remux the merged result so
    // the landed file is a .mp4 even when only WebM/mkv sources were available.
    // An explicit format or audio opts out.
    args.push("-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b", "--merge-output-format", "mp4");
  }
  if (audio) args.push("-x");
  if (raw?.length) args.push(...raw);
  args.push(url);

  return new Promise((resolve, reject) => {
    const child = spawn(BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (out += chunk));

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096);
    });

    const onAbort = () => child.kill();
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", reject);
    child.on("close", (code) => {
      ctx.signal.removeEventListener("abort", onAbort);
      if (ctx.signal.aborted) {
        reject(new DapiError("canceled", "Download canceled."));
      } else if (code === 0) {
        resolve({ paths: out.split("\n").map((line) => line.trim()).filter(Boolean) });
      } else {
        const detail = stderr.trim().split("\n").filter((l) => l.startsWith("ERROR")).pop();
        reject(new Error(detail ?? `yt-dlp exited with code ${code}.`));
      }
    });
  });
};
