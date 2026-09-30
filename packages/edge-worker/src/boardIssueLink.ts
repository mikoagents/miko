/**
 * Resolve platform + external URL for a board task identifier.
 * Identifiers:
 * - Linear: TEAM-123
 * - GitHub: Repo#123 or owner/repo#123
 * - GitLab MR: group/project!123
 */

export type BoardTrackerId = "linear" | "github" | "gitlab" | "slack";

const LINEAR_ID = /^[a-z0-9]+-\d+$/i;
const LINEAR_SLUG = /^[a-z0-9][a-z0-9_-]*$/i;
/** Repo#123 or owner/repo#123 */
const GITHUB_ID = /^(?:([\w.-]+)\/)?([\w.-]+)#(\d+)$/;
/** group/project!123 (GitLab MR) */
const GITLAB_MR_ID = /^([\w.-]+(?:\/[\w.-]+)*)!(\d+)$/;

export function inferBoardTrackerId(
	identifier: string | undefined,
	explicit?: string | undefined,
): BoardTrackerId | undefined {
	const known = explicit?.toLowerCase();
	if (
		known === "linear" ||
		known === "github" ||
		known === "gitlab" ||
		known === "slack"
	) {
		return known;
	}
	const id = identifier?.trim() ?? "";
	if (!id) return undefined;
	if (GITHUB_ID.test(id)) return "github";
	if (GITLAB_MR_ID.test(id)) return "gitlab";
	if (LINEAR_ID.test(id)) return "linear";
	return undefined;
}

function trimBase(url: string | undefined): string | undefined {
	const value = url?.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
	return value || undefined;
}

export function resolveBoardIssueUrl(input: {
	identifier?: string;
	trackerId?: string;
	linearWorkspaceSlug?: string;
	githubUrl?: string;
	gitlabUrl?: string;
}): string | undefined {
	const identifier = input.identifier?.trim();
	if (!identifier) return undefined;
	const tracker = inferBoardTrackerId(identifier, input.trackerId);

	if (tracker === "linear") {
		const slug = input.linearWorkspaceSlug?.trim();
		if (
			slug &&
			LINEAR_SLUG.test(slug) &&
			LINEAR_ID.test(identifier)
		) {
			return `https://linear.app/${encodeURIComponent(slug)}/issue/${encodeURIComponent(identifier)}/`;
		}
		return undefined;
	}

	if (tracker === "github") {
		const match = identifier.match(GITHUB_ID);
		if (!match) return undefined;
		const [, owner, repo, number] = match;
		const configured = trimBase(input.githubUrl);
		const base =
			configured ||
			(owner ? `https://github.com/${owner}/${repo}` : undefined);
		if (!base) return undefined;
		// /issues/N redirects to /pull/N when the number is a PR.
		return `${base}/issues/${number}`;
	}

	if (tracker === "gitlab") {
		const match = identifier.match(GITLAB_MR_ID);
		if (!match) return undefined;
		const number = match[2];
		const base = trimBase(input.gitlabUrl);
		if (!base) return undefined;
		return `${base}/-/merge_requests/${number}`;
	}

	return undefined;
}
