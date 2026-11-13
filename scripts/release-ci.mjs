import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export async function releaseCI({
  repository,
  sha,
  token,
  fetchImpl = fetch,
  now = Date.now,
  sleep = delay,
  log = console.log,
  timeoutMs = 45 * 60_000,
  discoveryMs = 90_000,
  pollMs = 30_000,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(sha) || !token) {
    throw new Error("Release CI requires a repository, exact commit SHA and GitHub token.");
  }
  const started = now();
  const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs`);
  url.search = new URLSearchParams({
    branch: "main",
    event: "push",
    head_sha: sha,
    per_page: "100",
  });

  while (true) {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`Cannot inspect main CI: GitHub returned ${response.status}.`);
    const data = await response.json();
    if (!Array.isArray(data.workflow_runs))
      throw new Error("Invalid GitHub workflow runs response.");
    const run = data.workflow_runs
      .filter(
        (candidate) =>
          candidate.head_sha === sha &&
          candidate.event === "push" &&
          candidate.head_branch === "main" &&
          candidate.head_repository?.full_name.toLowerCase() === repository.toLowerCase() &&
          candidate.path === ".github/workflows/ci.yml",
      )
      .sort((a, b) => b.id - a.id)[0];

    if (run?.status === "completed") {
      if (run.conclusion === "success") {
        log(`Reusing successful main CI: ${run.html_url}`);
        return { runChecks: false, url: run.html_url };
      }
      if (["cancelled", "skipped"].includes(run.conclusion)) {
        log(`Main CI was ${run.conclusion}; running the full release checks.`);
        return { runChecks: true };
      }
      throw new Error(`Main CI ${run.conclusion}: ${run.html_url}`);
    }
    if (!run && now() - started >= discoveryMs) {
      log("No trusted main CI found; running the full release checks.");
      return { runChecks: true };
    }
    if (now() - started >= timeoutMs) throw new Error("Timed out waiting for main CI.");
    log(run ? `Waiting for main CI: ${run.html_url}` : "Waiting for main CI to appear.");
    await sleep(Math.min(pollMs, timeoutMs - (now() - started)));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await releaseCI({
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    token: process.env.GH_TOKEN,
  });
  appendFileSync(process.env.GITHUB_OUTPUT, `run_checks=${result.runChecks}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      result.runChecks
        ? "Full reusable CI is required before publication.\n"
        : `Reused successful main CI for \`${process.env.GITHUB_SHA}\`: ${result.url}\n`,
    );
  }
}
