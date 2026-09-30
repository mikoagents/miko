import { RunnerTypeSchema } from "miko-core";
import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const AUTOMATION_RUNNERS = RunnerTypeSchema.options;
/** Suggested models per runner for the board form (free-text still allowed). */
export const AUTOMATION_MODEL_SUGGESTIONS: Record<
	(typeof AUTOMATION_RUNNERS)[number],
	string[]
> = {
	claude: ["opus", "sonnet", "haiku"],
	gemini: [
		"gemini-2.5-pro",
		"gemini-2.5-flash",
		"gemini-3.1-pro",
		"gemini-3.8-flash",
	],
	codex: ["gpt-5.5", "gpt-5.2-codex", "gpt-5-codex"],
	cursor: [
		"composer-2",
		"gemini-3.8-flash",
		"gemini-3.1-pro",
		"gpt-5.5",
		"claude-opus-5",
		"grok-4.6",
	],
	opencode: ["openai/gpt-5.5", "anthropic/claude-sonnet-4.5"],
	grok: ["grok-4.7", "grok-4.6", "grok-4.5"],
};

/**
 * Apply automation runner/model fields as leading [agent]/[model] tags so
 * RunnerSelectionService (and Linear issue dispatch) pick them up. Schema values
 * replace the matching legacy tag; omitted fields preserve existing selectors.
 */
export function applyAutomationRunnerModel(
	instructions: string,
	runner?: string,
	model?: string,
): string {
	if (!runner && !model) return instructions;
	let cleaned = instructions;
	if (runner) cleaned = cleaned.replace(/\[agent\s*=[^\]]*\]\s*/gi, "");
	if (model) cleaned = cleaned.replace(/\[model\s*=[^\]]*\]\s*/gi, "");
	const tags = [
		runner ? `[agent=${runner}]` : null,
		model ? `[model=${model}]` : null,
	].filter(Boolean);
	return `${tags.join("\n")}\n\n${cleaned.trimStart()}`;
}
export const scheduleSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("once"), at: z.iso.datetime() }),
	z.object({ kind: z.literal("daily"), time }),
	z.object({
		kind: z.literal("weekly"),
		time,
		days: z.array(z.number().int().min(0).max(6)).min(1),
	}),
	z.object({ kind: z.literal("cron"), expression: z.string().max(200) }),
]);
export const targetSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("direct_repository") }),
	/** Home-based ops session: no git worktree / repository binding. */
	z.object({ kind: z.literal("direct_ops") }),
	z.object({
		kind: z.literal("linear_issue"),
		workspaceId: z.string().min(1),
		teamId: z.string().min(1),
		projectId: z.string().min(1).optional(),
	}),
]);
/**
 * Resolve repository bindings. Prefers `repositoryIds`; falls back to legacy
 * single `repositoryId` so older on-disk automations keep loading.
 */
export function automationRepositoryIds(input: {
	repositoryIds?: string[] | null;
	repositoryId?: string | null;
}): string[] {
	const fromArray = (input.repositoryIds ?? []).filter(
		(id): id is string => typeof id === "string" && id.length > 0,
	);
	if (fromArray.length) return [...new Set(fromArray)];
	if (input.repositoryId) return [input.repositoryId];
	return [];
}

/** Rewrite legacy `repositoryId` into `repositoryIds` and drop the singular field. */
export function normalizeAutomationRepositories<
	T extends {
		repositoryIds?: string[] | null;
		repositoryId?: string | null;
	},
>(
	input: T,
): Omit<T, "repositoryId" | "repositoryIds"> & {
	repositoryIds?: string[];
} {
	const repositoryIds = automationRepositoryIds(input);
	const { repositoryId: _legacy, repositoryIds: _ignored, ...rest } = input;
	return repositoryIds.length ? { ...rest, repositoryIds } : { ...rest };
}

const automationFields = {
	name: z.string().trim().min(1).max(200),
	instructions: z.string().trim().min(1).max(50000),
	/**
	 * One or more repositories for repository-backed targets.
	 * Omit for direct_ops. Legacy `repositoryId` is accepted on read and
	 * normalized to this array before persistence.
	 */
	repositoryIds: z.array(z.string().min(1)).min(1).optional(),
	/** @deprecated Prefer repositoryIds; kept for reading older stored defs. */
	repositoryId: z.string().min(1).optional(),
	timezone: z.string().min(1).max(100),
	schedule: scheduleSchema,
	target: targetSchema,
	enabled: z.boolean(),
	/** Coding harness override; omit to use global/defaultRunner. */
	runner: RunnerTypeSchema.optional(),
	/** Model override for the selected runner; omit to use that runner's default. */
	model: z
		.string()
		.trim()
		.min(1)
		.max(200)
		.regex(
			/^[^\s[\]]+$/,
			"Model must be an identifier without whitespace or brackets",
		)
		.optional(),
};

function refineRepositories(
	input: {
		target: { kind: string };
		repositoryIds?: string[];
		repositoryId?: string;
	},
	ctx: z.RefinementCtx,
) {
	const ids = automationRepositoryIds(input);
	if (input.target.kind === "direct_ops") {
		if (ids.length) {
			ctx.addIssue({
				code: "custom",
				message: "Ops automations must not bind a repository",
				path: ["repositoryIds"],
			});
		}
		return;
	}
	if (!ids.length) {
		ctx.addIssue({
			code: "custom",
			message: "Repository is required",
			path: ["repositoryIds"],
		});
	}
}

export const automationInputSchema = z
	.object(automationFields)
	.superRefine(refineRepositories);
export const definitionSchema = z
	.object({
		...automationFields,
		id: z.string(),
		revision: z.number().int().positive(),
		createdAt: z.number(),
		updatedAt: z.number(),
		archived: z.boolean(),
		nextRunAt: z.number().nullable(),
		scheduleState: z.enum([
			"scheduled",
			"paused",
			"finished",
			"missed",
			"archived",
		]),
	})
	.superRefine(refineRepositories);
export const runSchema = z.object({
	id: z.string(),
	automationId: z.string(),
	key: z.string(),
	trigger: z.enum(["scheduled", "manual"]),
	scheduledAt: z.number(),
	createdAt: z.number(),
	updatedAt: z.number(),
	startedAt: z.number().optional(),
	status: z.enum([
		"dispatching",
		"waiting_session",
		"running",
		"awaiting_input",
		"succeeded",
		"failed",
		"skipped",
		"uncertain",
	]),
	snapshot: definitionSchema,
	issueId: z.string().optional(),
	issueUrl: z.string().optional(),
	sessionId: z.string().optional(),
	executionClaimedAt: z.number().optional(),
	prUrls: z.array(z.string()).default([]),
	message: z.string().default(""),
	attempts: z.number().int().default(0),
});
export type AutomationInput = z.infer<typeof automationInputSchema>;
export type AutomationDefinition = z.infer<typeof definitionSchema>;
export type AutomationTarget = z.infer<typeof targetSchema>;
export type AutomationRun = z.infer<typeof runSchema>;
export type RunUpdate = Partial<
	Pick<
		AutomationRun,
		| "status"
		| "message"
		| "issueUrl"
		| "sessionId"
		| "prUrls"
		| "executionClaimedAt"
	>
>;
export interface AutomationAdapter {
	validate(input: AutomationInput): Promise<void>;
	dispatch(run: AutomationRun): Promise<RunUpdate>;
	reconcile(run: AutomationRun): Promise<RunUpdate>;
}
export interface RepositoryTaskRequest {
	id: string;
	title: string;
	instructions: string;
	/** Absent for direct_ops (home-based) sessions. */
	repositoryId?: string;
	source: "automation" | "linear";
	issueContext?: { issueId: string; workspaceId: string };
	/** Optional coding harness for direct automation runs. */
	runner?: z.infer<typeof RunnerTypeSchema>;
	/** Optional model for direct automation runs. */
	model?: string;
}
export const activeRun = (run: AutomationRun) =>
	!["succeeded", "failed", "skipped"].includes(run.status);
export class AutomationError extends Error {
	constructor(
		message: string,
		public statusCode = 400,
	) {
		super(message);
	}
}
