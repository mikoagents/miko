/**
 * Commit authorship helpers for GitHub App vs local credential paths.
 *
 * - App token path: commits should be authored as the operator's App bot
 *   (`<slug>[bot]` / `<botUserId>+<slug>[bot]@users.noreply.github.com`).
 *   GitHub App HTTPS docs mention an appId form, but UI linking/avatars need
 *   the bot *user* id (GET /users/{slug}[bot]). The App slug/id are
 *   operator-defined — never hard-code a product bot name.
 * - Fallback path: keep the local `git config user.name` / `user.email`.
 * - Always append the mikoagent Co-authored-by trailer (once) so the
 *   separately registered GitHub user is attributed via trailer, not by
 *   impersonating mikoagent as the commit author.
 */

/** Registered GitHub user that must always appear as a co-author trailer. */
export const MIKOAGENT_COAUTHOR_NAME = "mikoagent";
export const MIKOAGENT_COAUTHOR_EMAIL =
	"332957360+mikoagent@users.noreply.github.com";
export const MIKOAGENT_COAUTHOR_TRAILER = `Co-authored-by: ${MIKOAGENT_COAUTHOR_NAME} <${MIKOAGENT_COAUTHOR_EMAIL}>`;

const COAUTHOR_LINE_RE =
	/^Co-authored-by:\s*mikoagent\s*<332957360\+mikoagent@users\.noreply\.github\.com>\s*$/im;

/**
 * Ensure the mikoagent Co-authored-by trailer is present exactly once.
 * Preserves other trailers and body text. Appends after a blank line when
 * missing. Does not touch git user.name / user.email.
 */
export function ensureMikoagentCoAuthorTrailer(message: string): string {
	const normalized = message.replace(/\r\n/g, "\n").replace(/\s+$/u, "");
	if (COAUTHOR_LINE_RE.test(normalized)) {
		return `${normalized}\n`;
	}
	if (normalized.length === 0) {
		return `${MIKOAGENT_COAUTHOR_TRAILER}\n`;
	}
	return `${normalized}\n\n${MIKOAGENT_COAUTHOR_TRAILER}\n`;
}

export interface GitHubAppBotIdentity {
	/** e.g. `my-agent[bot]` */
	name: string;
	/** e.g. `12345+my-agent[bot]@users.noreply.github.com` */
	email: string;
	/** Bare slug without `[bot]` suffix */
	slug: string;
}

/**
 * Build the GitHub-recognized bot author identity for a given App.
 * Email uses the bot *user* id (not the App id) so commit timeline avatars
 * and UI linking resolve: `<botUserId>+<slug>[bot]@users.noreply.github.com`.
 * GitHub App HTTPS docs mention an appId form, but that does not link to a
 * GitHub user (author:null / broken avatars).
 * @see https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation#git-over-https
 */
export function resolveGitHubAppBotIdentity(
	botUserId: string,
	slug: string,
): GitHubAppBotIdentity {
	const bare = slug.trim().replace(/\[bot\]$/i, "");
	const userId = botUserId.trim();
	if (!/^[1-9]\d*$/.test(userId) || !bare) {
		throw new Error(
			"resolveGitHubAppBotIdentity requires a positive numeric botUserId and non-empty slug",
		);
	}
	return {
		slug: bare,
		name: `${bare}[bot]`,
		email: `${userId}+${bare}[bot]@users.noreply.github.com`,
	};
}

/**
 * Resolve the operator-defined App slug from env.
 * Prefers `GITHUB_APP_SLUG`, then `GITHUB_BOT_USERNAME` (mention handle).
 */
export function resolveGitHubAppSlugFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const raw = env.GITHUB_APP_SLUG || env.GITHUB_BOT_USERNAME;
	if (!raw) return undefined;
	const bare = raw.trim().replace(/\[bot\]$/i, "");
	return bare || undefined;
}

/**
 * Resolve the numeric GitHub bot user id from env (`GITHUB_BOT_USER_ID`).
 * This is the id of `{slug}[bot]` (not `GITHUB_APP_ID`).
 */
export function resolveGitHubBotUserIdFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const raw = env.GITHUB_BOT_USER_ID;
	if (!raw) return undefined;
	const trimmed = raw.trim();
	return /^[1-9]\d*$/.test(trimmed) ? trimmed : undefined;
}
