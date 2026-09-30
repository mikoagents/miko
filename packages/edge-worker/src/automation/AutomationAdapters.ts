import { LinearClient, LinearDocument, LinearError } from "@linear/sdk";
import type { RepositoryConfig } from "miko-core";
import { automationCompletion } from "./completion.js";
import {
	AUTOMATION_MODEL_SUGGESTIONS,
	AUTOMATION_RUNNERS,
	type AutomationAdapter,
	AutomationError,
	type AutomationInput,
	type AutomationRun,
	applyAutomationRunnerModel,
	automationRepositoryIds,
	type RepositoryTaskRequest,
	type RunUpdate,
} from "./types.js";

export interface AutomationRunnerOptions {
	runners: typeof AUTOMATION_RUNNERS;
	defaultRunner: (typeof AUTOMATION_RUNNERS)[number];
	defaultModels: Record<string, string | undefined>;
	modelSuggestions: typeof AUTOMATION_MODEL_SUGGESTIONS;
}

export interface CreatedGitHubIssue {
	number: number;
	html_url: string;
	node_id?: string;
}

export interface AutomationAdapterDeps {
	/** Use the existing tracker client so OAuth refresh and token hot reload remain shared. */
	clientForWorkspace?(workspaceId: string): LinearClient | undefined;
	repositories(): RepositoryConfig[];
	workspaces(): Record<
		string,
		{ linearToken: string; linearWorkspaceName?: string }
	>;
	repoTags(description: string): { repo: string; branch?: string }[];
	startTask(request: RepositoryTaskRequest): Promise<void>;
	localState(run: AutomationRun): RunUpdate | undefined;
	/** Safe runner/model defaults for the Automations form. */
	runnerOptions?(): AutomationRunnerOptions;
	/**
	 * Create (or recover) a GitHub issue for a schedule run via the App/API
	 * token already used elsewhere in Miko. Required for github_issue targets.
	 */
	createGitHubIssue?(input: {
		repository: RepositoryConfig;
		title: string;
		body: string;
		/** Opaque run id embedded in the body for idempotent recovery. */
		runId: string;
	}): Promise<CreatedGitHubIssue>;
	/** Optional GET of an existing issue for reconcile (by number). */
	getGitHubIssue?(input: {
		repository: RepositoryConfig;
		number: number;
	}): Promise<{ html_url: string; state: string } | undefined>;
}

export class AutomationAdapters implements AutomationAdapter {
	constructor(
		private deps: AutomationAdapterDeps,
		private client = (token: string) =>
			new LinearClient({
				accessToken: token,
				signal: AbortSignal.timeout(30000),
			}),
	) {}
	private linear(workspaceId: string) {
		const workspace = this.deps.workspaces()[workspaceId];
		if (!workspace?.linearToken)
			throw new AutomationError("Linear connection is unavailable");
		if (this.deps.clientForWorkspace) {
			const client = this.deps.clientForWorkspace(workspaceId);
			if (!client)
				throw new AutomationError("Linear agent connection is unavailable");
			return client;
		}
		return this.client(workspace.linearToken);
	}
	options() {
		const runnerOptions = this.deps.runnerOptions?.() ?? {
			runners: AUTOMATION_RUNNERS,
			defaultRunner: "claude",
			defaultModels: Object.fromEntries(
				AUTOMATION_RUNNERS.map((runner) => [runner, undefined]),
			),
			modelSuggestions: AUTOMATION_MODEL_SUGGESTIONS,
		};
		return {
			repositories: this.deps.repositories().map((r) => ({
				id: r.id,
				name: r.name,
				workspaceId: r.linearWorkspaceId,
				githubUrl: r.githubUrl,
			})),
			workspaces: Object.entries(this.deps.workspaces()).map(([id, w]) => ({
				id,
				name: w.linearWorkspaceName || id,
			})),
			...runnerOptions,
		};
	}
	async linearOptions(workspaceId: string, teamId?: string) {
		const client = this.linear(workspaceId);
		const connection = teamId
			? await (await client.team(teamId)).projects({ first: 250 })
			: await client.teams({ first: 250 });
		const values = connection.nodes.map((n) => ({ id: n.id, name: n.name }));
		while (connection.pageInfo.hasNextPage) {
			await connection.fetchNext();
			for (const n of connection.nodes)
				if (!values.some((v) => v.id === n.id))
					values.push({ id: n.id, name: n.name });
		}
		return values;
	}
	async validate(input: AutomationInput) {
		try {
			await this.validateTarget(input);
		} catch (error) {
			throw this.normalizeError(error);
		}
	}
	private normalizeError(error: unknown) {
		if (
			error instanceof LinearError &&
			([
				"AuthenticationError",
				"Forbidden",
				"InvalidInput",
				"FeatureNotAccessible",
				"UserError",
			].includes(error.type || "") ||
				[400, 401, 403, 404].includes(error.status || 0))
		)
			return new AutomationError(
				"Linear rejected the request; check authorization and target configuration",
				error.status || 400,
			);
		return error;
	}
	private resolveRepositories(input: AutomationInput) {
		const ids = automationRepositoryIds(input);
		const repositories = ids.map((id) => {
			const repository = this.deps.repositories().find((r) => r.id === id);
			if (!repository || repository.isActive === false)
				throw new AutomationError("Repository is unavailable");
			return repository;
		});
		return { ids, repositories };
	}
	private async validateTarget(input: AutomationInput) {
		if (input.target.kind === "direct_ops") {
			if (this.deps.repoTags(input.instructions).length)
				throw new AutomationError(
					"Ops automations cannot include repository selectors",
				);
			return;
		}
		const { ids, repositories } = this.resolveRepositories(input);
		const selected = new Set(ids);
		const tags = this.deps.repoTags(input.instructions);
		if (
			tags.some((t) => {
				const matches = this.deps
					.repositories()
					.filter(
						(r) =>
							r.id === t.repo ||
							r.name.toLowerCase() === t.repo.toLowerCase() ||
							[r.githubUrl, r.gitlabUrl].some(
								(url) =>
									url?.endsWith(`/${t.repo}`) ||
									url?.endsWith(`/${t.repo}.git`),
							),
					);
				return (
					t.branch ||
					matches.length !== 1 ||
					!matches[0] ||
					!selected.has(matches[0].id)
				);
			})
		)
			throw new AutomationError(
				"Task repository selectors must match a selected repository without a branch override",
			);
		if (input.target.kind === "github_issue") {
			if (!this.deps.createGitHubIssue)
				throw new AutomationError(
					"GitHub issue creation is unavailable on this worker",
				);
			for (const repository of repositories) {
				if (!repository.githubUrl)
					throw new AutomationError(
						`Repository ${repository.name} has no GitHub URL configured`,
					);
			}
			return;
		}
		if (input.target.kind !== "linear_issue") return;
		const workspaceIds = [
			...new Set(
				repositories
					.map((repository) => repository.linearWorkspaceId)
					.filter(Boolean),
			),
		];
		// Linear issue creation is workspace-scoped; multi-repo is only allowed
		// when every selected repository maps to the same Linear workspace. The
		// first repository is the primary routing target for [repo=…] tags.
		if (
			workspaceIds.length !== 1 ||
			workspaceIds[0] !== input.target.workspaceId
		)
			throw new AutomationError(
				workspaceIds.length > 1
					? "Selected repositories must belong to the same Linear workspace"
					: "Repository does not belong to the selected Linear workspace",
			);
		for (const repository of repositories) {
			if (!/^[a-zA-Z0-9_\-/.]+$/.test(repository.id))
				throw new AutomationError(
					"Repository ID cannot be represented as a routing selector",
				);
		}
		const client = this.linear(input.target.workspaceId);
		const viewer = await client.viewer;
		if (!viewer.app || !viewer.supportsAgentSessions)
			throw new AutomationError(
				"Connect Linear with the miko agent's app authorization",
			);
		if ((await viewer.organization).id !== input.target.workspaceId)
			throw new AutomationError(
				"Linear connection belongs to a different workspace",
			);
		const team = await client.team(input.target.teamId);
		if (team.archivedAt) throw new AutomationError("Linear team is archived");
		const projectId = input.target.projectId;
		if (
			projectId &&
			!(await this.linearOptions(input.target.workspaceId, team.id)).some(
				(p) => p.id === projectId,
			)
		)
			throw new AutomationError("Project does not belong to the selected team");
	}
	async dispatch(run: AutomationRun): Promise<RunUpdate> {
		try {
			return await this.dispatchTarget(run);
		} catch (error) {
			throw this.normalizeError(error);
		}
	}
	private async dispatchTarget(run: AutomationRun): Promise<RunUpdate> {
		const input = run.snapshot;
		// A model-only override keeps the configured harness instead of inferring
		// another one from the model name. Existing explicit selectors still win.
		const runner =
			input.runner ??
			(input.model && !/\[agent\s*=[^\]]+\]/i.test(input.instructions)
				? (this.deps.runnerOptions?.().defaultRunner ?? "claude")
				: undefined);
		const instructions = applyAutomationRunnerModel(
			input.instructions,
			runner,
			input.model,
		);
		if (
			input.target.kind === "direct_repository" ||
			input.target.kind === "direct_ops"
		) {
			const repositoryId = automationRepositoryIds(input)[0];
			await this.deps.startTask({
				id: run.id,
				title: input.name,
				instructions,
				repositoryId,
				source: "automation",
				runner,
				model: input.model,
			});
			return { sessionId: `automation-${run.id}`, status: "running" };
		}
		if (input.target.kind === "github_issue") {
			return await this.dispatchGitHubIssue(run, instructions, runner);
		}
		const client = this.linear(input.target.workspaceId);
		const existing = await client.issues({
			filter: { id: { eq: run.issueId! } },
			first: 1,
		});
		if (existing.nodes[0])
			return { issueUrl: existing.nodes[0].url, status: "waiting_session" };
		const viewer = await client.viewer;
		const { ids, repositories } = this.resolveRepositories(input);
		if (!repositories.length)
			throw new AutomationError("Repository is unavailable");
		// Primary = first selected repository; additional repos are routing tags
		// so the Linear agent can attach matching worktrees in one session.
		const repoTags = ids.map((id) => `[repo=${id}]`).join("\n");
		const result = await client.createIssue({
			id: run.issueId,
			title: input.name,
			description: `${instructions}\n\n${repoTags}\n\nAutomation run: ${run.id}`,
			teamId: input.target.teamId,
			projectId: input.target.projectId,
			delegateId: viewer.id,
		});
		if (!result.success)
			throw new AutomationError("Linear rejected issue creation");
		const issue = await result.issue;
		return { status: "waiting_session", issueUrl: issue?.url };
	}
	async reconcile(run: AutomationRun): Promise<RunUpdate> {
		const local = this.deps.localState(run);
		if (local) return local;
		if (
			run.snapshot.target.kind === "direct_repository" ||
			run.snapshot.target.kind === "direct_ops"
		)
			return {
				status: "uncertain",
				message:
					run.message ||
					"Previous execution cannot be confirmed; it will not be restarted automatically",
			};
		if (run.snapshot.target.kind === "github_issue") {
			return await this.reconcileGitHubIssue(run);
		}
		const client = this.linear(run.snapshot.target.workspaceId);
		const issues = await client.issues({
			filter: { id: { eq: run.issueId! } },
			first: 1,
		});
		if (!issues.nodes.length)
			return {
				status: "uncertain",
				message: "Issue creation could not be confirmed",
			};
		let sessionId = run.sessionId;
		if (!sessionId) {
			const viewer = await client.viewer;
			const sessions = await client.agentSessions({
				first: 100,
				orderBy: LinearDocument.PaginationOrderBy.CreatedAt,
			});
			for (let page = 0; page < 5; page++) {
				const match = sessions.nodes.find(
					(session) =>
						session.issueId === run.issueId && session.appUserId === viewer.id,
				);
				if (match) {
					sessionId = match.id;
					break;
				}
				if (
					!sessions.pageInfo.hasNextPage ||
					sessions.nodes.some(
						(session) => session.createdAt.getTime() < run.createdAt - 60000,
					)
				)
					break;
				await sessions.fetchNext();
			}
		}
		if (sessionId) {
			const session = await client.agentSession(sessionId);
			if (session.status === "error")
				return {
					status: "failed",
					sessionId,
					message: "Confirmed failure from Linear agent session",
				};
			if (session.status === "complete") {
				const activities = await session.activities({ last: 50 });
				const response = [...activities.nodes]
					.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
					.find((a) => a.content.type === "response");
				return {
					sessionId,
					...automationCompletion(
						response &&
							"body" in response.content &&
							typeof response.content.body === "string"
							? response.content.body
							: "",
					),
				};
			}
			if (session.status === "awaitingInput")
				return {
					sessionId,
					status: "awaiting_input",
					message: "Waiting for an answer in Linear",
				};
			if (session.status === "active") return { sessionId, status: "running" };
		}
		return Date.now() - run.createdAt > 300000
			? {
					status: "uncertain",
					sessionId,
					issueUrl: issues.nodes[0]!.url,
					message:
						"Issue exists, but no active local execution is confirmed. Check delegation, webhook delivery and repository access.",
				}
			: {
					status: "waiting_session",
					sessionId,
					issueUrl: issues.nodes[0]!.url,
				};
	}

	/**
	 * GitHub Apps do not receive webhooks for events they create, so Linear-style
	 * delegate wake is impossible. Mirror the product intent by creating the issue
	 * for tracking, then starting the agent session directly (same as direct_repository).
	 */
	private async dispatchGitHubIssue(
		run: AutomationRun,
		instructions: string,
		runner: string | undefined,
	): Promise<RunUpdate> {
		if (!this.deps.createGitHubIssue)
			throw new AutomationError(
				"GitHub issue creation is unavailable on this worker",
			);
		const input = run.snapshot;
		const { repositories } = this.resolveRepositories(input);
		const repository = repositories[0];
		if (!repository) throw new AutomationError("Repository is unavailable");
		const body = `${instructions}\n\n[repo=${repository.id}]\n\nAutomation run: ${run.id}\n\n<!-- miko-automation-run:${run.id} -->`;
		const created =
			run.issueUrl && run.issueId
				? {
						number: Number(run.issueId),
						html_url: run.issueUrl,
					}
				: await this.deps.createGitHubIssue({
						repository,
						title: input.name,
						body,
						runId: run.id,
					});
		if (!Number.isFinite(created.number) || created.number <= 0)
			throw new AutomationError("GitHub rejected issue creation");
		const ownerRepo = parseGitHubOwnerRepo(repository.githubUrl || "");
		await this.deps.startTask({
			id: run.id,
			title: input.name,
			instructions,
			repositoryId: repository.id,
			source: "automation",
			runner,
			model: input.model,
			githubIssue: ownerRepo
				? {
						number: created.number,
						url: created.html_url,
						owner: ownerRepo.owner,
						repo: ownerRepo.repo,
					}
				: undefined,
		});
		return {
			issueId: String(created.number),
			issueUrl: created.html_url,
			sessionId: `automation-${run.id}`,
			status: "running",
		};
	}

	private async reconcileGitHubIssue(run: AutomationRun): Promise<RunUpdate> {
		const repositoryId = automationRepositoryIds(run.snapshot)[0];
		const repository = this.deps
			.repositories()
			.find((r) => r.id === repositoryId);
		const number = run.issueId ? Number(run.issueId) : NaN;
		if (
			repository &&
			Number.isFinite(number) &&
			number > 0 &&
			this.deps.getGitHubIssue
		) {
			const issue = await this.deps.getGitHubIssue({ repository, number });
			if (!issue)
				return {
					status: "uncertain",
					message: "GitHub issue creation could not be confirmed",
				};
			return {
				status: "uncertain",
				issueUrl: issue.html_url,
				message:
					run.message ||
					"Previous execution cannot be confirmed; it will not be restarted automatically",
			};
		}
		return {
			status: "uncertain",
			message:
				run.message ||
				"Previous execution cannot be confirmed; it will not be restarted automatically",
		};
	}
}

/** Parse owner/repo from common GitHub remote URL forms. */
export function parseGitHubOwnerRepo(
	url: string,
): { owner: string; repo: string } | null {
	if (!url || typeof url !== "string") return null;
	const trimmed = url.trim();
	const scp = trimmed.match(
		/^[\w.-]+@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i,
	);
	if (scp?.[1] && scp[2]) return { owner: scp[1], repo: scp[2] };
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
		? trimmed
		: `https://${trimmed}`;
	try {
		const parsed = new URL(withScheme);
		if (parsed.hostname.toLowerCase() !== "github.com") return null;
		const [owner, repoWithGit] = parsed.pathname.split("/").filter(Boolean);
		if (!owner || !repoWithGit) return null;
		return { owner, repo: repoWithGit.replace(/\.git$/i, "") };
	} catch {
		return null;
	}
}

