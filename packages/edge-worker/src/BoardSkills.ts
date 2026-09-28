import { readdir, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export type BoardSkillSource = "internal" | "user" | "repo";

export interface BoardSkill {
	name: string;
	description: string;
	source: BoardSkillSource;
	path: string;
	/** Plugin or repository label shown in the UI. */
	origin: string;
	/** False when a same-named user skill overrides this internal skill. */
	active: boolean;
}

function parseFrontmatterField(
	content: string,
	field: string,
): string | undefined {
	const match = content.match(
		new RegExp(`^---[\\s\\S]*?^${field}:\\s*(.+)$[\\s\\S]*?^---`, "m"),
	);
	return match?.[1]?.trim()?.replace(/^["']|["']$/g, "");
}

async function readSkillEntries(skillsDir: string): Promise<string[]> {
	try {
		const entries = await readdir(skillsDir, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => entry.name)
			.filter((name) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
			.sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}

async function describeSkill(
	skillsDir: string,
	name: string,
): Promise<{ description: string; path: string }> {
	const path = join(skillsDir, name);
	try {
		const content = await readFile(join(path, "SKILL.md"), "utf8");
		return {
			description: parseFrontmatterField(content, "description") || "",
			path,
		};
	} catch {
		return { description: "", path };
	}
}

function isPathInside(root: string, candidate: string): boolean {
	const base = resolve(root);
	const target = resolve(candidate);
	return target === base || target.startsWith(base + sep);
}

/**
 * List skills from Miko's installed plugins and optional repo-local checkouts
 * under `mikoHome/repos`. User skills shadow same-named internal skills.
 */
export async function listBoardSkills(mikoHome: string): Promise<BoardSkill[]> {
	const home = resolve(mikoHome);
	const internalDir = join(home, "miko-skills-plugin", "skills");
	const userDir = join(home, "user-skills-plugin", "skills");
	const reposRoot = join(home, "repos");

	const skills: BoardSkill[] = [];
	const userNames = new Set<string>();

	for (const name of await readSkillEntries(userDir)) {
		const { description, path } = await describeSkill(userDir, name);
		userNames.add(name);
		skills.push({
			name,
			description,
			source: "user",
			path,
			origin: "user-skills-plugin",
			active: true,
		});
	}

	for (const name of await readSkillEntries(internalDir)) {
		const { description, path } = await describeSkill(internalDir, name);
		skills.push({
			name,
			description,
			source: "internal",
			path,
			origin: "miko-skills-plugin",
			active: !userNames.has(name),
		});
	}

	let repoNames: string[] = [];
	try {
		repoNames = (await readdir(reposRoot, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => entry.name)
			.filter((name) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
			.sort((a, b) => a.localeCompare(b));
	} catch {
		repoNames = [];
	}

	for (const repo of repoNames) {
		const skillsDir = join(reposRoot, repo, ".claude", "skills");
		if (!isPathInside(reposRoot, skillsDir)) continue;
		for (const name of await readSkillEntries(skillsDir)) {
			const { description, path } = await describeSkill(skillsDir, name);
			if (!isPathInside(reposRoot, path)) continue;
			skills.push({
				name,
				description,
				source: "repo",
				path,
				origin: repo,
				active: true,
			});
		}
	}

	return skills.sort((a, b) => {
		if (a.name !== b.name) return a.name.localeCompare(b.name);
		const order = { user: 0, internal: 1, repo: 2 } as const;
		return order[a.source] - order[b.source];
	});
}

/** Resolve an allowlisted skill directory for opening in the file manager. */
export function resolveAllowedBoardSkill(
	mikoHome: string,
	source: string,
	name: string,
	repository?: string,
): { path: string } | null {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) return null;
	const home = resolve(mikoHome);
	let candidate: string;
	if (source === "user") {
		candidate = join(home, "user-skills-plugin", "skills", name);
	} else if (source === "internal") {
		candidate = join(home, "miko-skills-plugin", "skills", name);
	} else if (
		source === "repo" &&
		repository &&
		/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(repository)
	) {
		candidate = join(home, "repos", repository, ".claude", "skills", name);
	} else {
		return null;
	}
	if (!isPathInside(home, candidate)) return null;
	return { path: candidate };
}
