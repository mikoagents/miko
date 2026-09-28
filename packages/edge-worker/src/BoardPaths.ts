import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
	type BoardResourcesInfo,
	collectBoardResources,
} from "./BoardResources.js";

export type BoardDirectoryId =
	| "home"
	| "worktrees"
	| "repos"
	| "logs"
	| "state"
	| "automations"
	| "skillsInternal"
	| "skillsUser"
	| "release";

export interface BoardDirectory {
	id: BoardDirectoryId;
	label: string;
	description: string;
	path: string;
	exists: boolean;
}

/** Safe repository summary for the Status board (no tokens/secrets). */
export interface BoardRepositoryInfo {
	id: string;
	name: string;
	githubUrl?: string;
	gitlabUrl?: string;
	repositoryPath: string;
	workspaceBaseDir?: string;
	baseBranch: string;
	isActive: boolean;
	linearWorkspaceId?: string;
	linearWorkspaceName?: string;
	linearWorkspaceSlug?: string;
	/** True when repositoryPath exists on disk. */
	checkoutExists: boolean;
}

/** Safe install defaults for the Status board. */
export interface BoardDefaultsInfo {
	defaultRunner?: string | null;
	claudeDefaultModel?: string | null;
	claudeDefaultFallbackModel?: string | null;
	cursorDefaultModel?: string | null;
	cursorDefaultFallbackModel?: string | null;
	grokDefaultModel?: string | null;
	grokDefaultFallbackModel?: string | null;
}

/**
 * Linear workspace summary for Status.
 * Never includes tokens, refresh tokens, or OAuth client credentials.
 */
export interface BoardWorkspaceInfo {
	id: string;
	name?: string;
	slug?: string;
	tokenConfigured: boolean;
	oauthConfigured: boolean;
}

export interface BoardStatusInfo {
	app: "miko-board";
	version: string | null;
	service: { online: true; status: "idle" | "busy" };
	uptimeSeconds: number;
	startedAt: string;
	platform: NodeJS.Platform;
	nodeVersion: string;
	pid: number;
	cwd: string;
	directories: BoardDirectory[];
	automationCount?: number;
	resources: BoardResourcesInfo;
	repositories: BoardRepositoryInfo[];
	defaults?: BoardDefaultsInfo;
	workspaces?: BoardWorkspaceInfo[];
}

export interface BoardPathsOptions {
	mikoHome: string;
	version?: string | null;
	getStatus(): "idle" | "busy";
	releaseDir?: string;
	startedAt?: number;
	getAutomationCount?(): number;
	repositories?: BoardRepositoryInfo[];
	defaults?: BoardDefaultsInfo;
	workspaces?: BoardWorkspaceInfo[];
}

const DIRECTORY_META: Record<
	BoardDirectoryId,
	{ label: string; description: string }
> = {
	home: {
		label: "Miko home",
		description: "Config, env files, state, and local data",
	},
	worktrees: {
		label: "Worktrees",
		description: "Per-session working directories",
	},
	repos: {
		label: "Repos",
		description: "Checked-out repositories",
	},
	logs: {
		label: "Logs",
		description: "Worker and runner log files",
	},
	state: {
		label: "State",
		description: "Persisted board and session state",
	},
	automations: {
		label: "Automations",
		description: "Scheduled automation definitions",
	},
	skillsInternal: {
		label: "Bundled skills",
		description: "Default Miko workflow skills plugin",
	},
	skillsUser: {
		label: "User skills",
		description: "Custom skills managed for this install",
	},
	release: {
		label: "Release / install",
		description: "Installed Miko launcher and release files",
	},
};

function defaultReleaseDir(): string {
	return (
		process.env.MIKO_SHARE_DIR?.trim() ||
		join(homedir(), ".local", "share", "miko")
	);
}

function isPathInside(root: string, candidate: string): boolean {
	const base = resolve(root);
	const target = resolve(candidate);
	return target === base || target.startsWith(base + sep);
}

/** Resolve known Miko directories from the running installation. */
export function resolveBoardDirectories(
	mikoHome: string,
	releaseDir = defaultReleaseDir(),
): BoardDirectory[] {
	const home = resolve(mikoHome);
	const release = resolve(releaseDir);
	const entries: Array<[BoardDirectoryId, string]> = [
		["home", home],
		["worktrees", join(home, "worktrees")],
		["repos", join(home, "repos")],
		["logs", join(home, "logs")],
		["state", join(home, "state")],
		["automations", join(home, "automations")],
		["skillsInternal", join(home, "miko-skills-plugin", "skills")],
		["skillsUser", join(home, "user-skills-plugin", "skills")],
		["release", release],
	];
	return entries.map(([id, path]) => ({
		id,
		label: DIRECTORY_META[id].label,
		description: DIRECTORY_META[id].description,
		path,
		exists: existsSync(path),
	}));
}

/**
 * Allow only known Miko directories under the configured home and release roots.
 * Rejects path traversal and arbitrary absolute paths.
 */
export function resolveAllowedBoardDirectory(
	id: string,
	mikoHome: string,
	releaseDir = defaultReleaseDir(),
): BoardDirectory | null {
	if (!(id in DIRECTORY_META)) return null;
	const directories = resolveBoardDirectories(mikoHome, releaseDir);
	const match = directories.find((entry) => entry.id === id);
	if (!match) return null;
	const home = resolve(mikoHome);
	const release = resolve(releaseDir);
	if (!isPathInside(home, match.path) && !isPathInside(release, match.path))
		return null;
	return match;
}

/** Input shape for building a safe board repository row (no secrets). */
export interface BoardRepositoryInput {
	id: string;
	name: string;
	githubUrl?: string;
	gitlabUrl?: string;
	repositoryPath: string;
	workspaceBaseDir?: string;
	baseBranch: string;
	isActive?: boolean;
	linearWorkspaceId?: string;
	linearWorkspaceName?: string;
	linearWorkspaceSlug?: string;
}

/** Map configured repositories into Status-safe rows with checkout existence. */
export function buildBoardRepositories(
	repositories: BoardRepositoryInput[],
): BoardRepositoryInfo[] {
	return repositories
		.map((repo) => ({
			id: repo.id,
			name: repo.name,
			githubUrl: repo.githubUrl,
			gitlabUrl: repo.gitlabUrl,
			repositoryPath: repo.repositoryPath,
			workspaceBaseDir: repo.workspaceBaseDir,
			baseBranch: repo.baseBranch,
			isActive: repo.isActive !== false,
			linearWorkspaceId: repo.linearWorkspaceId,
			linearWorkspaceName: repo.linearWorkspaceName,
			linearWorkspaceSlug: repo.linearWorkspaceSlug,
			checkoutExists: existsSync(resolve(repo.repositoryPath)),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Map Linear workspaces into Status-safe rows (flags only, no credentials). */
export function buildBoardWorkspaces(
	workspaces: Record<
		string,
		{
			linearWorkspaceName?: string;
			linearWorkspaceSlug?: string;
			linearToken?: string;
			linearRefreshToken?: string;
			linearOAuth?: unknown;
		}
	>,
): BoardWorkspaceInfo[] {
	return Object.entries(workspaces)
		.map(([id, workspace]) => ({
			id,
			name: workspace.linearWorkspaceName,
			slug: workspace.linearWorkspaceSlug,
			tokenConfigured: Boolean(workspace.linearToken?.trim()),
			oauthConfigured: Boolean(workspace.linearOAuth),
		}))
		.sort(
			(a, b) =>
				(a.name || a.slug || a.id).localeCompare(b.name || b.slug || b.id),
		);
}

export async function buildBoardStatus(
	options: BoardPathsOptions,
): Promise<BoardStatusInfo> {
	const startedAt = options.startedAt ?? Date.now() - process.uptime() * 1000;
	const releaseDir = options.releaseDir ?? defaultReleaseDir();
	const directories = resolveBoardDirectories(options.mikoHome, releaseDir);
	const resources = await collectBoardResources({
		mikoHome: options.mikoHome,
		releaseDir,
	});
	return {
		app: "miko-board",
		version: options.version ?? null,
		service: { online: true, status: options.getStatus() },
		uptimeSeconds: Math.floor(process.uptime()),
		startedAt: new Date(startedAt).toISOString(),
		platform: process.platform,
		nodeVersion: process.version,
		pid: process.pid,
		cwd: process.cwd(),
		directories,
		automationCount: options.getAutomationCount?.(),
		resources,
		repositories: options.repositories ?? [],
		defaults: options.defaults,
		workspaces: options.workspaces,
	};
}

function openCommand(path: string): { command: string; args: string[] } {
	if (process.platform === "darwin") return { command: "open", args: [path] };
	if (process.platform === "win32")
		return { command: "explorer.exe", args: [path] };
	return { command: "xdg-open", args: [path] };
}

/** Attempt to open a path with the OS file manager; never throws. */
export async function openPathInFileManager(
	path: string,
): Promise<{ path: string; opened: boolean }> {
	const { command, args } = openCommand(path);
	try {
		await new Promise<void>((resolvePromise, reject) => {
			const child = spawn(command, args, {
				detached: true,
				stdio: "ignore",
			});
			child.once("error", reject);
			child.once("spawn", () => {
				child.unref();
				resolvePromise();
			});
		});
		return { path, opened: true };
	} catch {
		// Headless hosts often lack a file manager; callers can still copy the path.
		return { path, opened: false };
	}
}

/** Open an allowlisted directory in the OS file manager when possible. */
export async function openBoardDirectory(
	id: string,
	mikoHome: string,
	releaseDir = defaultReleaseDir(),
): Promise<
	{ ok: true; path: string; opened: boolean } | { ok: false; error: string }
> {
	const directory = resolveAllowedBoardDirectory(id, mikoHome, releaseDir);
	if (!directory) return { ok: false, error: "Directory is not allowlisted" };
	if (!directory.exists)
		return {
			ok: false,
			error: `Directory does not exist: ${directory.path}`,
		};
	const result = await openPathInFileManager(directory.path);
	return { ok: true, ...result };
}
