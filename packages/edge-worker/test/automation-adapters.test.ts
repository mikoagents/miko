import type { LinearClient } from "@linear/sdk";
import type { RepositoryConfig } from "miko-core";
import { describe, expect, it, vi } from "vitest";
import {
	type AutomationAdapterDeps,
	AutomationAdapters,
} from "../src/automation/AutomationAdapters.js";
import {
	AUTOMATION_COMPLETION_INSTRUCTIONS,
	AUTOMATION_OPS_COMPLETION_INSTRUCTIONS,
	automationCompletion,
	automationOpsCompletion,
} from "../src/automation/completion.js";
import {
	AUTOMATION_MODEL_SUGGESTIONS,
	AUTOMATION_RUNNERS,
	type AutomationRun,
} from "../src/automation/types.js";

function fixture() {
	const repository = {
		id: "repo-1",
		name: "Human readable repo",
		linearWorkspaceId: "ws",
		githubUrl: "https://github.com/acme/repo-1",
		isActive: true,
	} as RepositoryConfig;
	const client = {
		viewer: Promise.resolve({
			id: "agent",
			app: true,
			supportsAgentSessions: true,
			organization: Promise.resolve({ id: "ws" }),
		}),
		team: vi.fn(async () => ({ id: "team", archivedAt: null })),
		issues: vi.fn(async () => ({ nodes: [] as { url: string }[] })),
		createIssue: vi.fn(async () => ({
			success: true,
			issue: Promise.resolve({ url: "https://linear.app/ws/issue/T-1" }),
		})),
		agentSession: vi.fn(),
		agentSessions: vi.fn(async () => ({
			nodes: [],
			pageInfo: { hasNextPage: false },
		})),
	};
	const deps: AutomationAdapterDeps = {
		repositories: () => [repository],
		workspaces: () => ({
			ws: { linearToken: "private-token", linearWorkspaceName: "Workspace" },
		}),
		repoTags: () => [],
		startTask: vi.fn(async () => {}),
		localState: () => undefined,
	};
	const factory = vi.fn(() => client as unknown as LinearClient);
	const adapter = new AutomationAdapters(deps, factory);
	const run = {
		id: "run-1",
		automationId: "auto",
		issueId: "issue-uuid",
		status: "dispatching",
		createdAt: Date.now(),
		prUrls: [],
		snapshot: {
			name: "Fix it",
			instructions: "Implement and verify",
			repositoryIds: ["repo-1"],
			target: { kind: "linear_issue", workspaceId: "ws", teamId: "team" },
		},
	} as AutomationRun;
	return { adapter, client, deps, run, factory };
}

describe("automation platform adapters", () => {
	it("keeps the configured default runner when only a model is selected", async () => {
		const { adapter, deps, run } = fixture();
		deps.runnerOptions = () => ({
			runners: AUTOMATION_RUNNERS,
			defaultRunner: "cursor",
			defaultModels: { cursor: "composer-2" },
			modelSuggestions: AUTOMATION_MODEL_SUGGESTIONS,
		});
		run.snapshot.target = { kind: "direct_repository" };
		run.snapshot.model = "gpt-5.5";
		await adapter.dispatch(run);
		expect(deps.startTask).toHaveBeenCalledWith({
			id: "run-1",
			title: "Fix it",
			instructions: "[agent=cursor]\n[model=gpt-5.5]\n\nImplement and verify",
			repositoryId: "repo-1",
			source: "automation",
			runner: "cursor",
			model: "gpt-5.5",
		});
	});
	it("includes explicit runner and model selectors in delegated Linear issues", async () => {
		const { adapter, client, run } = fixture();
		run.snapshot.runner = "cursor";
		run.snapshot.model = "gpt-5.5";
		await adapter.dispatch(run);
		expect(client.createIssue).toHaveBeenCalledWith({
			id: "issue-uuid",
			title: "Fix it",
			description:
				"[agent=cursor]\n[model=gpt-5.5]\n\nImplement and verify\n\n[repo=repo-1]\n\nAutomation run: run-1",
			teamId: "team",
			projectId: undefined,
			delegateId: "agent",
		});
	});
	it("creates with a durable issue ID, agent delegation and an unambiguous repository ID", async () => {
		const { adapter, client, run } = fixture();
		await adapter.validate(run.snapshot);
		expect(await adapter.dispatch(run)).toEqual({
			status: "waiting_session",
			issueUrl: "https://linear.app/ws/issue/T-1",
		});
		expect(client.createIssue).toHaveBeenCalledWith({
			id: "issue-uuid",
			title: "Fix it",
			description:
				"Implement and verify\n\n[repo=repo-1]\n\nAutomation run: run-1",
			teamId: "team",
			projectId: undefined,
			delegateId: "agent",
		});
	});
	it("recovers a successful creation whose response was lost without creating again", async () => {
		const { adapter, client, run } = fixture();
		client.issues.mockResolvedValue({
			nodes: [{ url: "https://linear.app/existing" }],
		});
		expect(await adapter.dispatch(run)).toEqual({
			status: "waiting_session",
			issueUrl: "https://linear.app/existing",
		});
		expect(client.createIssue).not.toHaveBeenCalled();
	});
	it("validates a direct repository task with no Linear connection and never calls Linear", async () => {
		const { adapter, deps, run, factory } = fixture();
		run.snapshot.target = { kind: "direct_repository" };
		deps.workspaces = () => ({});
		await adapter.validate(run.snapshot);
		expect(await adapter.dispatch(run)).toEqual({
			sessionId: "automation-run-1",
			status: "running",
		});
		expect(factory).not.toHaveBeenCalled();
		expect(deps.startTask).toHaveBeenCalledWith({
			id: "run-1",
			title: "Fix it",
			instructions: "Implement and verify",
			repositoryId: "repo-1",
			source: "automation",
		});
	});
	it("rejects human credentials, cross-workspace repositories and conflicting selectors", async () => {
		const { adapter, deps, run, client } = fixture();
		client.viewer = Promise.resolve({
			id: "human",
			app: false,
			supportsAgentSessions: false,
			organization: Promise.resolve({ id: "ws" }),
		});
		await expect(adapter.validate(run.snapshot)).rejects.toThrow(
			"app authorization",
		);
		run.snapshot.target = {
			kind: "linear_issue",
			workspaceId: "different",
			teamId: "team",
		};
		await expect(adapter.validate(run.snapshot)).rejects.toThrow(
			"does not belong",
		);
		run.snapshot.target = { kind: "direct_repository" };
		deps.repoTags = () => [{ repo: "another" }];
		await expect(adapter.validate(run.snapshot)).rejects.toThrow("selectors");
	});
	it("reports missing webhook delivery as uncertain and exposes no credentials in options", async () => {
		const { adapter, client, run } = fixture();
		client.issues.mockResolvedValue({
			nodes: [{ url: "https://linear.app/existing" }],
		});
		run.createdAt -= 300001;
		expect(await adapter.reconcile(run)).toMatchObject({ status: "uncertain" });
		expect(JSON.stringify(adapter.options())).not.toContain("private-token");
	});
	it("does not interpret Linear's turn-complete state as a completed development task", async () => {
		const { adapter, client, run } = fixture();
		run.sessionId = "session";
		client.issues.mockResolvedValue({
			nodes: [{ url: "https://linear.app/existing" }],
		});
		client.agentSession.mockResolvedValue({
			status: "complete",
			activities: async () => ({
				nodes: [
					{
						createdAt: new Date(),
						content: {
							type: "response",
							body: "I finished coding; tests are next.",
						},
					},
				],
			}),
		});
		expect(await adapter.reconcile(run)).toMatchObject({ status: "uncertain" });
	});
});

it("validates and dispatches a direct_ops task without a repository", async () => {
	const { adapter, deps, run } = fixture();
	run.snapshot.target = { kind: "direct_ops" };
	delete (run.snapshot as { repositoryIds?: string[] }).repositoryIds;
	await adapter.validate(run.snapshot);
	expect(await adapter.dispatch(run)).toEqual({
		sessionId: "automation-run-1",
		status: "running",
	});
	expect(deps.startTask).toHaveBeenCalledWith({
		id: "run-1",
		title: "Fix it",
		instructions: "Implement and verify",
		repositoryId: undefined,
		source: "automation",
	});
});
it("rejects repository selectors and repositoryIds on direct_ops", async () => {
	const { adapter, deps, run } = fixture();
	run.snapshot.target = { kind: "direct_ops" };
	delete (run.snapshot as { repositoryIds?: string[] }).repositoryIds;
	deps.repoTags = () => [{ repo: "repo-1" }];
	await expect(adapter.validate(run.snapshot)).rejects.toThrow(
		"repository selectors",
	);
});

it("creates a GitHub issue then wakes the agent via startTask", async () => {
	const { adapter, deps, run, factory } = fixture();
	const createGitHubIssue = vi.fn(async () => ({
		number: 42,
		html_url: "https://github.com/acme/repo-1/issues/42",
	}));
	deps.createGitHubIssue = createGitHubIssue;
	run.snapshot.target = { kind: "github_issue" };
	await adapter.validate(run.snapshot);
	expect(await adapter.dispatch(run)).toEqual({
		issueId: "42",
		issueUrl: "https://github.com/acme/repo-1/issues/42",
		sessionId: "automation-run-1",
		status: "running",
	});
	expect(factory).not.toHaveBeenCalled();
	expect(createGitHubIssue).toHaveBeenCalledWith(
		expect.objectContaining({
			title: "Fix it",
			runId: "run-1",
			body: expect.stringContaining("<!-- miko-automation-run:run-1 -->"),
		}),
	);
	expect(deps.startTask).toHaveBeenCalledWith(
		expect.objectContaining({
			id: "run-1",
			repositoryId: "repo-1",
			source: "automation",
			githubIssue: {
				number: 42,
				url: "https://github.com/acme/repo-1/issues/42",
				owner: "acme",
				repo: "repo-1",
			},
		}),
	);
});

it("rejects github_issue when the repository has no GitHub URL", async () => {
	const { adapter, deps, run } = fixture();
	deps.createGitHubIssue = vi.fn();
	deps.repositories = () =>
		[
			{
				id: "repo-1",
				name: "No github",
				linearWorkspaceId: "ws",
				isActive: true,
			},
		] as never;
	run.snapshot.target = { kind: "github_issue" };
	await expect(adapter.validate(run.snapshot)).rejects.toThrow("GitHub URL");
});

it("reuses an existing GitHub issue link on dispatch retry", async () => {
	const { adapter, deps, run } = fixture();
	const createGitHubIssue = vi.fn();
	deps.createGitHubIssue = createGitHubIssue;
	run.snapshot.target = { kind: "github_issue" };
	run.issueId = "7";
	run.issueUrl = "https://github.com/acme/repo-1/issues/7";
	await adapter.dispatch(run);
	expect(createGitHubIssue).not.toHaveBeenCalled();
	expect(deps.startTask).toHaveBeenCalledWith(
		expect.objectContaining({
			githubIssue: expect.objectContaining({ number: 7 }),
		}),
	);
});

it("fans out is handled by the service; adapter dispatches the run snapshot's single repo", async () => {
	const { adapter, deps, run } = fixture();
	run.snapshot.target = { kind: "direct_repository" };
	run.snapshot.repositoryIds = ["repo-1"];
	await adapter.dispatch(run);
	expect(deps.startTask).toHaveBeenCalledTimes(1);
	expect(deps.startTask).toHaveBeenCalledWith(
		expect.objectContaining({ repositoryId: "repo-1" }),
	);
});
it("rejects linear multi-repo across different workspaces and accepts same-workspace set", async () => {
	const { adapter, deps, run } = fixture();
	deps.repositories = () =>
		[
			{
				id: "repo-1",
				name: "A",
				linearWorkspaceId: "ws",
				isActive: true,
			},
			{
				id: "repo-2",
				name: "B",
				linearWorkspaceId: "ws",
				isActive: true,
			},
			{
				id: "repo-3",
				name: "C",
				linearWorkspaceId: "other",
				isActive: true,
			},
		] as never;
	run.snapshot.repositoryIds = ["repo-1", "repo-2"];
	await adapter.validate(run.snapshot);
	await adapter.dispatch(run);
	expect(deps.startTask).not.toHaveBeenCalled();
	run.snapshot.repositoryIds = ["repo-1", "repo-3"];
	await expect(adapter.validate(run.snapshot)).rejects.toThrow(
		"same Linear workspace",
	);
});
it("includes every selected repository as a Linear routing tag", async () => {
	const { adapter, client, deps, run } = fixture();
	deps.repositories = () =>
		[
			{
				id: "repo-1",
				name: "A",
				linearWorkspaceId: "ws",
				isActive: true,
			},
			{
				id: "repo-2",
				name: "B",
				linearWorkspaceId: "ws",
				isActive: true,
			},
		] as never;
	run.snapshot.repositoryIds = ["repo-1", "repo-2"];
	await adapter.dispatch(run);
	expect(client.createIssue).toHaveBeenCalledWith(
		expect.objectContaining({
			description: expect.stringContaining("[repo=repo-1]\n[repo=repo-2]"),
		}),
	);
});

describe("development completion contract", () => {
	it("requires a final verified outcome or a reasoned no-change result", () => {
		expect(automationCompletion("Just finished coding")).toMatchObject({
			status: "uncertain",
		});
		expect(
			automationCompletion(
				'Done\n<!-- miko-automation-result {"outcome":"succeeded","reason":"Tests passed","prUrls":["https://github.com/org/repo/pull/1"]} -->',
			),
		).toEqual({
			status: "succeeded",
			message: "Done",
			prUrls: ["https://github.com/org/repo/pull/1"],
		});
		expect(
			automationCompletion(
				'<!-- miko-automation-result {"outcome":"no_change","reason":"Already up to date","prUrls":[]} -->',
			),
		).toEqual({
			status: "succeeded",
			message: "Already up to date",
			prUrls: [],
		});
		expect(
			automationCompletion(
				'<!-- miko-automation-result {"outcome":"succeeded","reason":"Done","prUrls":[]} -->',
			),
		).toMatchObject({ status: "uncertain" });
		expect(
			automationCompletion(
				'<!-- miko-automation-result {"outcome":"awaiting_input","reason":"Which release?","prUrls":[]} -->',
			),
		).toMatchObject({ status: "awaiting_input" });
	});
	it("keeps the complete automation instructions stable", () => {
		expect(
			AUTOMATION_COMPLETION_INSTRUCTIONS,
		).toBe(`This scheduled development run must include implementation, verification, and a pull request when changes are needed. Do not treat an intermediate step as task completion.
At the end of your final response, include a hidden completion record:
<!-- miko-automation-result {"outcome":"succeeded","reason":"Completed and verified","prUrls":["https://github.com/owner/repo/pull/123"]} -->
Use outcome "no_change" with a specific reason and an empty prUrls array when no changes are necessary; "awaiting_input" when clarification is required; or "failed" when blocked or unsuccessful. Only report "succeeded" after verification and PR creation. Never invent a PR URL.`);
	});
	it("allows ops automations to succeed without a pull request", () => {
		expect(
			automationOpsCompletion(
				'Done\n<!-- miko-automation-result {"outcome":"succeeded","reason":"Archived 12 issues","prUrls":[]} -->',
			),
		).toEqual({
			status: "succeeded",
			message: "Done",
			prUrls: [],
		});
		expect(AUTOMATION_OPS_COMPLETION_INSTRUCTIONS).toContain(
			"no code repository",
		);
	});
});
