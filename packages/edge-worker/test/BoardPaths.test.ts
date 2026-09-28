import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildBoardRepositories,
	buildBoardStatus,
	buildBoardWorkspaces,
	openBoardDirectory,
	resolveAllowedBoardDirectory,
	resolveBoardDirectories,
} from "../src/BoardPaths.js";
import {
	listBoardSkills,
	resolveAllowedBoardSkill,
} from "../src/BoardSkills.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempHome() {
	const home = await mkdtemp(join(tmpdir(), "miko-board-paths-"));
	cleanups.push(() => rm(home, { recursive: true, force: true }));
	for (const name of [
		"worktrees",
		"repos",
		"logs",
		"state",
		"automations",
		"miko-skills-plugin/skills",
		"user-skills-plugin/skills",
	]) {
		await mkdir(join(home, name), { recursive: true });
	}
	return home;
}

describe("BoardPaths", () => {
	it("rejects allowlisted directories symlinked outside the configured roots", async () => {
		const home = await tempHome();
		const outside = await tempHome();
		await rm(join(home, "logs"), { recursive: true });
		await symlink(outside, join(home, "logs"), "dir");
		expect(resolveAllowedBoardDirectory("logs", home)).toBeNull();
	});
	it("resolves known directories under miko home and release root", async () => {
		const home = await tempHome();
		const release = join(home, "release-root");
		await mkdir(release);
		const directories = resolveBoardDirectories(home, release);
		expect(directories.map((d) => d.id)).toEqual([
			"home",
			"worktrees",
			"repos",
			"logs",
			"state",
			"automations",
			"skillsInternal",
			"skillsUser",
			"release",
		]);
		expect(directories.find((d) => d.id === "home")?.path).toBe(home);
		expect(directories.find((d) => d.id === "release")?.path).toBe(release);
	});

	it("rejects unknown and traversal directory ids", async () => {
		const home = await tempHome();
		expect(resolveAllowedBoardDirectory("../etc", home)).toBeNull();
		expect(resolveAllowedBoardDirectory("home", home)?.path).toBe(home);
		const result = await openBoardDirectory("not-a-dir", home);
		expect(result).toEqual({
			ok: false,
			error: "Directory is not allowlisted",
		});
	});

	it("builds status payload with runtime fields", async () => {
		const home = await tempHome();
		const status = await buildBoardStatus({
			mikoHome: home,
			version: "0.2.72",
			getStatus: () => "idle",
			getAutomationCount: () => 3,
			startedAt: Date.parse("2026-09-28T00:00:00.000Z"),
		});
		expect(status).toMatchObject({
			app: "miko-board",
			version: "0.2.72",
			service: { online: true, status: "idle" },
			automationCount: 3,
			repositories: [],
		});
		expect(status.directories.length).toBeGreaterThan(5);
		expect(status.pid).toBe(process.pid);
		expect(status.resources.cpu.cores).toBeGreaterThan(0);
		expect(status.resources.memory.totalBytes).toBeGreaterThan(0);
		expect(status.resources.disks.length).toBeGreaterThan(0);
	});

	it("includes configured repositories, defaults, and workspaces", async () => {
		const home = await tempHome();
		const repoPath = join(home, "repos", "demo");
		await mkdir(repoPath, { recursive: true });
		const repositories = buildBoardRepositories([
			{
				id: "repo-1",
				name: "demo",
				githubUrl: "https://github.com/acme/demo",
				repositoryPath: repoPath,
				workspaceBaseDir: join(home, "worktrees"),
				baseBranch: "main",
				isActive: true,
				linearWorkspaceId: "ws-1",
				linearWorkspaceName: "Acme",
				linearWorkspaceSlug: "acme",
			},
			{
				id: "repo-2",
				name: "missing",
				repositoryPath: join(home, "repos", "missing"),
				baseBranch: "develop",
				isActive: false,
			},
		]);
		const workspaces = buildBoardWorkspaces({
			"ws-1": {
				linearWorkspaceName: "Acme",
				linearWorkspaceSlug: "acme",
				linearToken: "lin_api_secret",
				linearOAuth: { clientId: "oauth-client-id", clientSecret: "secret" },
			},
			"ws-2": {
				linearWorkspaceName: "Other",
				linearWorkspaceSlug: "other",
			},
		});
		const status = await buildBoardStatus({
			mikoHome: home,
			version: "0.2.72",
			getStatus: () => "busy",
			repositories,
			workspaces,
			defaults: {
				defaultRunner: "grok",
				grokDefaultModel: "grok-4.7",
			},
		});
		expect(status.repositories).toHaveLength(2);
		expect(status.repositories[0]).toMatchObject({
			name: "demo",
			githubUrl: "https://github.com/acme/demo",
			checkoutExists: true,
			linearWorkspaceSlug: "acme",
			isActive: true,
		});
		expect(status.repositories[1]).toMatchObject({
			name: "missing",
			checkoutExists: false,
			isActive: false,
		});
		expect(status.defaults).toEqual({
			defaultRunner: "grok",
			grokDefaultModel: "grok-4.7",
		});
		expect(status.workspaces).toEqual([
			{
				id: "ws-1",
				name: "Acme",
				slug: "acme",
				tokenConfigured: true,
				oauthConfigured: true,
			},
			{
				id: "ws-2",
				name: "Other",
				slug: "other",
				tokenConfigured: false,
				oauthConfigured: false,
			},
		]);
		const serialized = JSON.stringify(status);
		expect(serialized).not.toContain("lin_api_secret");
		expect(serialized).not.toContain("oauth-client-id");
		expect(serialized).not.toContain("clientSecret");
	});
});

describe("BoardSkills", () => {
	it("rejects skill and manifest symlinks outside Miko home", async () => {
		const home = await tempHome();
		const outside = await tempHome();
		await writeFile(
			join(outside, "SKILL.md"),
			"---\ndescription: External content\n---\n",
		);
		await symlink(
			outside,
			join(home, "user-skills-plugin/skills/external"),
			"dir",
		);
		const linkedManifest = join(home, "user-skills-plugin/skills/manifest");
		await mkdir(linkedManifest);
		await symlink(join(outside, "SKILL.md"), join(linkedManifest, "SKILL.md"));
		expect(resolveAllowedBoardSkill(home, "user", "external")).toBeNull();
		expect(await listBoardSkills(home)).toEqual([]);
	});

	it("lists skill symlinks whose targets stay within Miko home", async () => {
		const home = await tempHome();
		const target = join(home, "shared-skill");
		await mkdir(target);
		await writeFile(
			join(target, "SKILL.md"),
			"---\ndescription: Shared skill\n---\n",
		);
		await symlink(
			target,
			join(home, "user-skills-plugin/skills/shared"),
			"dir",
		);
		expect(resolveAllowedBoardSkill(home, "user", "shared")).not.toBeNull();
		expect(await listBoardSkills(home)).toEqual([
			expect.objectContaining({ name: "shared", description: "Shared skill" }),
		]);
	});
	it("lists internal, user, and repo skills with shadowing", async () => {
		const home = await tempHome();
		await mkdir(join(home, "miko-skills-plugin/skills/debug"), {
			recursive: true,
		});
		await writeFile(
			join(home, "miko-skills-plugin/skills/debug/SKILL.md"),
			"---\nname: debug\ndescription: Bundled debug skill\n---\n",
		);
		await mkdir(join(home, "miko-skills-plugin/skills/summarize"), {
			recursive: true,
		});
		await writeFile(
			join(home, "miko-skills-plugin/skills/summarize/SKILL.md"),
			"---\nname: summarize\ndescription: Bundled summarize\n---\n",
		);
		await mkdir(join(home, "user-skills-plugin/skills/debug"), {
			recursive: true,
		});
		await writeFile(
			join(home, "user-skills-plugin/skills/debug/SKILL.md"),
			"---\nname: debug\ndescription: User override\n---\n",
		);
		await mkdir(join(home, "repos/demo/.claude/skills/custom"), {
			recursive: true,
		});
		await writeFile(
			join(home, "repos/demo/.claude/skills/custom/SKILL.md"),
			"---\nname: custom\ndescription: Repo skill\n---\n",
		);

		const skills = await listBoardSkills(home);
		expect(skills).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "debug",
					source: "user",
					active: true,
					description: "User override",
				}),
				expect.objectContaining({
					name: "debug",
					source: "internal",
					active: false,
					description: "Bundled debug skill",
				}),
				expect.objectContaining({
					name: "summarize",
					source: "internal",
					active: true,
				}),
				expect.objectContaining({
					name: "custom",
					source: "repo",
					origin: "demo",
					active: true,
					description: "Repo skill",
				}),
			]),
		);
	});

	it("only resolves allowlisted skill paths", async () => {
		const home = await tempHome();
		await mkdir(join(home, "user-skills-plugin/skills/debug"));
		await mkdir(join(home, "repos/demo/.claude/skills/custom"), {
			recursive: true,
		});
		expect(resolveAllowedBoardSkill(home, "user", "debug")?.path).toBe(
			join(home, "user-skills-plugin/skills/debug"),
		);
		expect(resolveAllowedBoardSkill(home, "internal", "../etc")).toBeNull();
		expect(
			resolveAllowedBoardSkill(home, "repo", "custom", "../escape"),
		).toBeNull();
		expect(resolveAllowedBoardSkill(home, "repo", "custom", "demo")?.path).toBe(
			join(home, "repos/demo/.claude/skills/custom"),
		);
	});
});
