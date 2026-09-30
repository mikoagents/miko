import { describe, expect, it } from "vitest";
import {
	formatRepositoryNames,
	formFromDefinition,
	formWithRepositories,
	formWithRepository,
	formWithTarget,
	formWithTeam,
	inputFromForm,
	modelChoices,
	modelIconKind,
	resolveAutomationModel,
	runnerIconKind,
	scheduleFromForm,
} from "../board/automation-model.mjs";

const options = {
	repositories: [{ id: "repo", workspaceId: "ws" }],
	workspaces: [{ id: "ws" }],
};
describe("automation form serialization", () => {
	it("derives a fresh Linear target when switching from Ops back to a repository", () => {
		const original = {
			...formFromDefinition(undefined, options),
			target: "linear_issue",
			teamId: "team",
			projectId: "project",
		};
		const ops = formWithTarget(original, "direct_ops", options);
		expect(inputFromForm(ops).target).toEqual({ kind: "direct_ops" });
		expect(inputFromForm(ops)).not.toHaveProperty("repositoryIds");
		const linear = formWithTarget(ops, "linear_issue", {
			...options,
			repositories: [{ id: "repo2", workspaceId: "ws2" }],
		});
		expect(linear.repositoryIds).toEqual(["repo2"]);
		expect(inputFromForm(linear).target).toEqual({
			kind: "linear_issue",
			workspaceId: "ws2",
			teamId: "",
		});
	});
	it("suggests models for the configured runner when Agent is Default", () => {
		expect(
			modelChoices(
				{
					defaultRunner: "cursor",
					defaultModels: { cursor: "composer-2" },
					modelSuggestions: {
						cursor: ["composer-2", "gpt-5.5"],
						claude: ["sonnet"],
					},
				},
				"",
			),
		).toEqual(["composer-2", "gpt-5.5"]);
	});
	it("can clear legacy runner and model selections back to defaults", () => {
		const form = formFromDefinition(
			{
				name: "Legacy task",
				instructions: "[agent=cursor]\n[model=gemini-3.8-flash]\n\nDo work",
				target: { kind: "direct_repository" },
				schedule: { kind: "daily", time: "09:00" },
			},
			options,
		);
		const saved = inputFromForm({ ...form, runner: "", model: "" });
		expect(saved.instructions).toBe("Do work");
		const reopened = formFromDefinition(saved, options);
		expect(reopened.runner).toBe("");
		expect(reopened.model).toBe("");
	});
	it("preserves existing weekly rules, target and timezone through editing", () => {
		const input = {
			name: "Weekly maintenance",
			instructions: "Check dependencies",
			repositoryIds: ["repo"],
			schedule: { kind: "weekly", days: [1, 5], time: "09:30" },
			timezone: "America/New_York",
			enabled: false,
			target: {
				kind: "linear_issue",
				workspaceId: "ws",
				teamId: "team",
				projectId: "project",
			},
		};
		expect(inputFromForm(formFromDefinition(input, options))).toEqual(input);
	});
	it("derives the workspace from the repository and clears a mismatched target", () => {
		const form = formFromDefinition(
			{
				repositoryIds: ["repo"],
				schedule: { kind: "daily", time: "09:00" },
				target: {
					kind: "linear_issue",
					workspaceId: "other-workspace",
					teamId: "old-team",
					projectId: "old-project",
				},
			},
			options,
		);
		expect(inputFromForm(form).target).toEqual({
			kind: "linear_issue",
			workspaceId: "ws",
			teamId: "",
		});
	});
	it("does not silently replace an unavailable repository", () => {
		const form = formFromDefinition(
			{
				repositoryIds: ["removed-repo"],
				schedule: { kind: "daily", time: "09:00" },
				target: { kind: "linear_issue", workspaceId: "ws", teamId: "team" },
			},
			options,
		);
		expect(form.repositoryIds).toEqual([]);
		expect(inputFromForm(form).target).toEqual({
			kind: "linear_issue",
			workspaceId: "",
			teamId: "",
		});
	});
	it("keeps a project only while the selected workspace and team still match", () => {
		const form = {
			...formFromDefinition(undefined, options),
			target: "linear_issue",
			teamId: "team",
			projectId: "project",
		};
		const sameWorkspace = formWithRepository(form, {
			id: "repo2",
			workspaceId: "ws",
		});
		expect(inputFromForm(sameWorkspace).target).toEqual({
			kind: "linear_issue",
			workspaceId: "ws",
			teamId: "team",
			projectId: "project",
		});
		expect(inputFromForm(formWithTeam(sameWorkspace, "team")).target).toEqual(
			inputFromForm(form).target,
		);
		expect(
			inputFromForm(formWithTeam(sameWorkspace, "new-team")).target,
		).toEqual({
			kind: "linear_issue",
			workspaceId: "ws",
			teamId: "new-team",
		});
		expect(
			inputFromForm(
				formWithRepository(form, { id: "repo3", workspaceId: "ws2" }),
			).target,
		).toEqual({
			kind: "linear_issue",
			workspaceId: "ws2",
			teamId: "",
		});
		expect(
			inputFromForm(formWithRepository(form, { id: "local-repo" })).target,
		).toEqual({
			kind: "linear_issue",
			workspaceId: "",
			teamId: "",
		});
	});
	it("preserves the absolute instant of a one-time task in the browser's timezone", () => {
		const definition = {
			target: { kind: "direct_repository" },
			schedule: { kind: "once", at: "2028-10-05T01:30:00.000Z" },
			timezone: "America/New_York",
		};
		const form = formFromDefinition(definition, options);
		expect(scheduleFromForm(form)).toEqual(definition.schedule);
		expect(inputFromForm(form).timezone).toBe(
			Intl.DateTimeFormat().resolvedOptions().timeZone,
		);
	});
	it("rejects an empty weekly selection and an invalid appointment before sending", () => {
		expect(() =>
			scheduleFromForm({ kind: "weekly", days: [], time: "09:00" }),
		).toThrow("weekday");
		expect(() => scheduleFromForm({ kind: "once", at: "" })).toThrow(
			"date and time",
		);
	});
	it("omits inactive Linear fields when switching to direct execution", () => {
		const form = {
			...formFromDefinition(undefined, options),
			teamId: "old-team",
			projectId: "old-project",
		};
		expect(inputFromForm(form).target).toEqual({ kind: "direct_repository" });
		expect(form.workspaceId).toBe("ws");
	});
	it("preserves runner and model through editing", () => {
		const input = {
			name: "Frontier digest",
			instructions: "Collect news",
			repositoryIds: ["repo"],
			schedule: { kind: "daily", time: "09:00" },
			timezone: "Asia/Shanghai",
			enabled: true,
			target: { kind: "direct_repository" },
			runner: "cursor",
			model: "gemini-3.8-flash",
		};
		expect(inputFromForm(formFromDefinition(input, options))).toEqual(input);
	});
	it("reads legacy agent/model tags when schema fields are unset", () => {
		const form = formFromDefinition(
			{
				instructions: "[agent=cursor]\n[model=gemini-3.8-flash]\n\nDo the work",
				target: { kind: "direct_repository" },
				schedule: { kind: "daily", time: "09:00" },
			},
			options,
		);
		expect(form.runner).toBe("cursor");
		expect(form.model).toBe("gemini-3.8-flash");
	});
	it("omits default runner and blank model from the saved input", () => {
		const form = {
			...formFromDefinition(undefined, options),
			runner: "",
			model: "  ",
		};
		const input = inputFromForm(form);
		expect(input).not.toHaveProperty("runner");
		expect(input).not.toHaveProperty("model");
	});
	it("omits repositoryIds for direct_ops and preserves them for repository modes", () => {
		const opsForm = {
			...formFromDefinition(
				{
					target: { kind: "direct_ops" },
					schedule: { kind: "daily", time: "04:00" },
				},
				options,
			),
			name: "Linear cap",
			instructions: "Follow linear-issue-cap",
			target: "direct_ops",
			repositoryIds: ["should-be-ignored"],
		};
		expect(inputFromForm(opsForm)).toMatchObject({
			name: "Linear cap",
			target: { kind: "direct_ops" },
		});
		expect(inputFromForm(opsForm)).not.toHaveProperty("repositoryIds");

		const repoForm = {
			...formFromDefinition(undefined, options),
			name: "Repo task",
			instructions: "Do work",
			target: "direct_repository",
			repositoryIds: ["repo"],
		};
		expect(inputFromForm(repoForm).repositoryIds).toEqual(["repo"]);
	});
	it("serializes github_issue target without Linear fields", () => {
		const form = {
			...formFromDefinition(undefined, options),
			target: "github_issue",
			repositoryIds: ["repo"],
			teamId: "should-ignore",
			workspaceId: "ws",
		};
		expect(inputFromForm(form).target).toEqual({ kind: "github_issue" });
		expect(inputFromForm(form).repositoryIds).toEqual(["repo"]);
	});
	it("loads legacy singular repositoryId into repositoryIds", () => {
		const form = formFromDefinition(
			{
				repositoryId: "repo",
				target: { kind: "direct_repository" },
				schedule: { kind: "daily", time: "09:00" },
			},
			options,
		);
		expect(form.repositoryIds).toEqual(["repo"]);
		expect(inputFromForm(form).repositoryIds).toEqual(["repo"]);
	});
	it("supports selecting multiple repositories and clears workspace when they diverge", () => {
		const multi = {
			repositories: [
				{ id: "repo-a", workspaceId: "ws" },
				{ id: "repo-b", workspaceId: "ws" },
				{ id: "repo-c", workspaceId: "other" },
			],
			workspaces: [{ id: "ws" }, { id: "other" }],
		};
		const form = formWithRepositories(
			{ ...formFromDefinition(undefined, multi), target: "linear_issue" },
			[multi.repositories[0], multi.repositories[1]],
		);
		expect(form.repositoryIds).toEqual(["repo-a", "repo-b"]);
		expect(form.workspaceId).toBe("ws");
		expect(inputFromForm(form).repositoryIds).toEqual(["repo-a", "repo-b"]);
		const diverged = formWithRepositories(form, [
			multi.repositories[0],
			multi.repositories[2],
		]);
		expect(diverged.workspaceId).toBe("");
		expect(diverged.teamId).toBe("");
	});
	it("formats repository names and resolves list model labels", () => {
		const repositories = [
			{ id: "repo-a", name: "Alpha" },
			{ id: "repo-b", name: "Beta" },
			{ id: "repo-c", name: "Gamma" },
		];
		expect(
			formatRepositoryNames({ target: { kind: "direct_ops" } }, repositories),
		).toBe("No repository");
		expect(
			formatRepositoryNames(
				{
					repositoryIds: ["repo-a", "repo-b"],
					target: { kind: "direct_repository" },
				},
				repositories,
			),
		).toBe("Alpha, Beta");
		expect(
			formatRepositoryNames(
				{
					repositoryIds: ["repo-a", "repo-b", "repo-c"],
					target: { kind: "direct_repository" },
				},
				repositories,
			),
		).toBe("Alpha +2");
		expect(
			resolveAutomationModel(
				{ model: "gpt-5.5", instructions: "Do work" },
				{ defaultModels: { cursor: "composer-2" }, defaultRunner: "cursor" },
			),
		).toBe("gpt-5.5");
		expect(
			resolveAutomationModel(
				{ instructions: "[model=sonnet]\n\nDo work" },
				{ defaultModels: { claude: "opus" }, defaultRunner: "claude" },
			),
		).toBe("sonnet");
		expect(
			resolveAutomationModel(
				{ instructions: "Do work", runner: "cursor" },
				{ defaultModels: { cursor: "composer-2" }, defaultRunner: "claude" },
			),
		).toBe("composer-2");
		expect(resolveAutomationModel({ instructions: "Do work" }, {})).toBe(
			"Default",
		);
	});
});

describe("automation brand icon mapping", () => {
	it("maps model ids to provider icon kinds with a generic fallback", () => {
		expect(modelIconKind("gpt-5.5")).toBe("openai");
		expect(modelIconKind("claude-opus-5")).toBe("claude");
		expect(modelIconKind("sonnet")).toBe("claude");
		expect(modelIconKind("gemini-3.8-flash")).toBe("gemini");
		expect(modelIconKind("grok-4.7")).toBe("grok");
		expect(modelIconKind("composer-2")).toBe("cursor");
		expect(modelIconKind("gpt-5-codex")).toBe("codex");
		expect(modelIconKind("mystery-model")).toBe("generic");
		expect(modelIconKind("")).toBe("generic");
	});
	it("maps runners to brand icon kinds", () => {
		expect(runnerIconKind("claude")).toBe("claude-code");
		expect(runnerIconKind("cursor")).toBe("cursor");
		expect(runnerIconKind("opencode")).toBe("opencode");
		expect(runnerIconKind("")).toBe("generic");
	});
});
