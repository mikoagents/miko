import { describe, expect, it, vi } from "vitest";
import {
	type AutomationAdapterDeps,
	AutomationAdapters,
} from "../src/automation/AutomationAdapters.js";
import {
	type AutomationRun,
	applyAutomationRunnerModel,
	automationInputSchema,
} from "../src/automation/types.js";

describe("applyAutomationRunnerModel", () => {
	it("preserves a legacy runner when only the model is overridden", () => {
		expect(
			applyAutomationRunnerModel(
				"[agent=cursor]\n[model=old]\nDo work",
				undefined,
				"gpt-5.5",
			),
		).toBe("[model=gpt-5.5]\n\n[agent=cursor]\nDo work");
	});
	it("rejects model values that could inject routing tags", () => {
		expect(
			automationInputSchema.shape.model.safeParse("gpt-5.5]\n[repo=other")
				.success,
		).toBe(false);
	});
	it("leaves instructions unchanged when no overrides are set", () => {
		expect(applyAutomationRunnerModel("[agent=grok]\nDo work")).toBe(
			"[agent=grok]\nDo work",
		);
	});
	it("prepends agent/model tags and replaces legacy tags", () => {
		expect(
			applyAutomationRunnerModel(
				"[agent=grok]\n[model=grok-4.6]\n\nDo the work",
				"cursor",
				"gemini-3.8-flash",
			),
		).toBe("[agent=cursor]\n[model=gemini-3.8-flash]\n\nDo the work");
	});
});

describe("AutomationAdapters runner/model dispatch", () => {
	it("passes tagged instructions and runner/model on direct dispatch", async () => {
		const startTask = vi.fn(async () => {});
		const adapters = new AutomationAdapters({
			repositories: () => [
				{ id: "repo", name: "repo", isActive: true } as never,
			],
			workspaces: () => ({}),
			repoTags: () => [],
			startTask,
			localState: () => undefined,
		} satisfies AutomationAdapterDeps);
		const run = {
			id: "run-1",
			snapshot: {
				name: "Task",
				instructions: "Do the work",
				repositoryId: "repo",
				target: { kind: "direct_repository" },
				runner: "cursor",
				model: "gemini-3.8-flash",
			},
		} as AutomationRun;
		await adapters.dispatch(run);
		expect(startTask).toHaveBeenCalledWith({
			id: "run-1",
			title: "Task",
			instructions: "[agent=cursor]\n[model=gemini-3.8-flash]\n\nDo the work",
			repositoryId: "repo",
			source: "automation",
			runner: "cursor",
			model: "gemini-3.8-flash",
		});
	});
	it("exposes runners and model suggestions on options", () => {
		const adapters = new AutomationAdapters({
			repositories: () => [],
			workspaces: () => ({}),
			repoTags: () => [],
			startTask: async () => {},
			localState: () => undefined,
			runnerOptions: () => ({
				runners: ["cursor", "grok"] as never,
				defaultRunner: "grok",
				defaultModels: { grok: "grok-4.7", cursor: "composer-2" },
				modelSuggestions: {
					claude: [],
					gemini: [],
					codex: [],
					cursor: ["composer-2"],
					opencode: [],
					grok: ["grok-4.7"],
				},
			}),
		});
		expect(adapters.options()).toMatchObject({
			defaultRunner: "grok",
			defaultModels: { grok: "grok-4.7" },
			runners: ["cursor", "grok"],
		});
	});
});
