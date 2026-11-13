import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function preserveContainerReference(notes, existing, repository) {
  const prefix = `Container: ghcr.io/${repository.toLowerCase()}@sha256:`;
  const references = existing
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix) && /^[0-9a-f]{64}$/.test(line.slice(prefix.length)));
  if (references.length > 1)
    throw new Error("Release has multiple container digests; refusing to overwrite notes.");
  return `${notes.trim()}\n${references.length ? `\n${references[0]}\n` : ""}`;
}

export async function syncReleaseNotes({ repository, tag, notes, token, fetchImpl = fetch }) {
  if (!repository || !tag || !token)
    throw new Error("Repository, release tag and GitHub token are required.");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const base = `https://api.github.com/repos/${repository}/releases`;
  const response = await fetchImpl(`${base}/tags/${encodeURIComponent(tag)}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Cannot read release: GitHub returned ${response.status}.`);
  const release = await response.json();
  const body = preserveContainerReference(notes, release.body ?? "", repository);
  const updated = await fetchImpl(`${base}/${release.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!updated.ok) throw new Error(`Cannot update release: GitHub returned ${updated.status}.`);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const synced = await syncReleaseNotes({
    repository: process.env.GITHUB_REPOSITORY,
    tag: process.env.RELEASE_TAG,
    notes: readFileSync(process.env.RELEASE_NOTES_PATH, "utf8"),
    token: process.env.GH_TOKEN,
  });
  console.log(
    synced
      ? "Updated release notes; preserved the container digest."
      : "Release does not exist yet; nothing to sync.",
  );
}
