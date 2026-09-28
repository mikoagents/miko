import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildBoardStatus,
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
		const status = buildBoardStatus({
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
		});
		expect(status.directories.length).toBeGreaterThan(5);
		expect(status.pid).toBe(process.pid);
	});
});

describe("BoardSkills", () => {
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
		expect(resolveAllowedBoardSkill(home, "user", "debug")?.path).toBe(
			join(home, "user-skills-plugin/skills/debug"),
		);
		expect(resolveAllowedBoardSkill(home, "internal", "../etc")).toBeNull();
		expect(
			resolveAllowedBoardSkill(home, "repo", "custom", "../escape"),
		).toBeNull();
		expect(
			resolveAllowedBoardSkill(home, "repo", "custom", "demo")?.path,
		).toBe(join(home, "repos/demo/.claude/skills/custom"));
	});
});
