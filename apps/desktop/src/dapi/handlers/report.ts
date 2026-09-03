/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import { arch, platform, release } from "node:os";
import { DapiError, ISSUE_LOG_TAIL } from "@diffusionstudio/dapi";
import { formatLogEntry } from "./logs";

import type { MainHandler } from "../handler";

const REPO = "diffusionstudio/editor";

const GH_MISSING =
  "gh (GitHub CLI) is not installed, so the issue cannot be filed. Install it from https://cli.github.com, run `gh auth login`, then retry.";

function fence(language: string, content: string): string {
  return `\`\`\`${language}\n${content}\n\`\`\``;
}

function environmentTable(version: string): string {
  const rows: Array<[string, string]> = [
    ["app", version],
    ["platform", `${platform()} ${release()} (${arch()})`],
    ["electron", process.versions.electron ?? "unknown"],
  ];
  return ["| | |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");
}

function buildIssueBody(input: { body?: string; commands?: string[]; logs: string[]; version: string }): string {
  const sections: string[] = [];
  if (input.body?.trim()) sections.push(input.body.trim());
  if (input.commands?.length) sections.push(`## Repro\n\n${fence("sh", input.commands.join("\n"))}`);
  sections.push(`## Environment\n\n${environmentTable(input.version)}`);
  if (input.logs.length) sections.push(`## App logs\n\n${fence("", input.logs.join("\n"))}`);
  return `${sections.join("\n\n")}\n`;
}

// --repo is explicit because the app is not a checkout of the editor; the body
// goes over stdin so a long log tail can't blow the argv size limit.
function createIssue(title: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const gh = spawn("gh", ["issue", "create", "--repo", REPO, "--title", title, "--body-file", "-"]);

    let stdout = "";
    let stderr = "";
    gh.stdout.on("data", (chunk) => (stdout += chunk));
    gh.stderr.on("data", (chunk) => (stderr += chunk));

    gh.on("error", (e) => {
      reject((e as NodeJS.ErrnoException).code === "ENOENT" ? new DapiError("unsupported", GH_MISSING) : e);
    });
    gh.on("close", (code) => {
      if (code !== 0) {
        // gh explains itself well (not authenticated, no access, rate limited).
        reject(new Error(stderr.trim() || `gh issue create exited with code ${code}`));
        return;
      }
      const url = stdout.trim().split("\n").pop() ?? "";
      if (!url.startsWith("https://")) {
        reject(new Error(`gh issue create did not print an issue URL: ${stdout.trim() || "(no output)"}`));
        return;
      }
      resolve(url);
    });

    gh.stdin.on("error", () => {}); // gh exiting early (auth failure) breaks the pipe
    gh.stdin.end(body);
  });
}

export const report: MainHandler<"report"> = async ({ title, body, commands, logs }, ctx) => {
  const summary = title.trim();
  if (!summary) throw new DapiError("invalid-input", "A one-line title is required.");
  const tail = logs ?? ISSUE_LOG_TAIL;
  const lines = tail > 0 ? ctx.logs().slice(-tail).map(formatLogEntry) : [];
  const url = await createIssue(summary, buildIssueBody({ body, commands, logs: lines, version: ctx.version }));
  return { url };
};
