import { describe, expect, it, vi } from "vitest";
import { AUTOMATION_OPS_COMPLETION_INSTRUCTIONS } from "../src/automation/completion.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { RunnerConfigBuilder } from "../src/RunnerConfigBuilder.js";
import { ToolPermissionResolver } from "../src/ToolPermissionResolver.js";

function fixture(connected = true) {
	const worker = Object.create(EdgeWorker.prototype);
	worker.config = {
		linearAllowedTools: ["Read(**)"],
		linearWorkspaces: connected ? { ws: { linearToken: "test-token" } } : {},
	};
	worker.mikoHome = "/tmp/miko-ops-test";
	worker.repositories = new Map();
	worker.logger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		withContext() {
			return this;
		},
	};
	worker.gitService = {
		createGitWorktree: vi.fn(async () => ({
			path: "/tmp/miko-ops-test/automation-workspaces/AUTO-run-1",
			isGitWorktree: false,
		})),
	};
	worker.agentSessionManager = {
		getSession: vi.fn(),
		createChatSession: vi.fn(),
		setActivitySink: vi.fn(),
		addAgentRunner: vi.fn(),
	};
	worker.automationActivitySink = (sink: unknown) => sink;
	worker.automations = { update: vi.fn(async () => {}) };
	worker.updateAutomationSession = vi.fn(async () => {});
	worker.loadSharedInstructions = vi.fn(async () => "Shared task instructions");
	worker.skillsPluginResolver = {
		resolve: vi.fn(async () => []),
		discoverSkillNames: vi.fn(async () => []),
	};
	worker.toolPermissionResolver = new ToolPermissionResolver(
		worker.config,
		worker.logger,
	);
	worker.runnerSelectionService = {
		determineRunnerSelection: vi.fn(() => ({
			runnerType: "codex",
			modelOverride: "gpt-5.5",
		})),
		getDefaultRunner: () => "claude",
		getDefaultModelForRunner: () => "sonnet",
		getDefaultFallbackModelForRunner: () => undefined,
	};
	const mcpConfig = {
		linear: { type: "http" as const, url: "https://mcp.example.test" },
	};
	worker.mcpConfigService = {
		buildMcpConfig: vi.fn(() => mcpConfig),
		buildMergedMcpConfigPath: () => undefined,
	};
	worker.runnerConfigBuilder = new RunnerConfigBuilder(
		worker.toolPermissionResolver,
		worker.mcpConfigService,
		worker.runnerSelectionService,
	);
	const runner = {
		start: vi.fn(async () => {}),
		supportsStreamingInput: false,
	};
	worker.createRunnerForType = vi.fn(() => runner);
	worker.savePersistedState = vi.fn(async () => {});
	const request = {
		id: "run-1",
		title: "Ops task",
		instructions: "[agent=codex]\n[model=gpt-5.5]\nInspect the fixture",
		source: "automation" as const,
	};
	return { worker, runner, request, mcpConfig };
}

describe("repository-free automation execution", () => {
	it.each([
		"claude",
		"codex",
		"cursor",
	])("applies the configured sandbox to %s operations", async (runnerType) => {
		const { worker, request } = fixture(false);
		worker.runnerSelectionService.determineRunnerSelection.mockReturnValue({
			runnerType,
		});
		worker.sdkSandboxSettings = { enabled: true, httpProxyPort: 19080 };
		worker.egressCaCertPath = "/tmp/miko-ops-test/ca.pem";
		await worker.startDirectRepositoryTask(request);
		const config = worker.createRunnerForType.mock.calls[0][1];
		const workspace = "/tmp/miko-ops-test/automation-workspaces/AUTO-run-1";
		if (runnerType === "claude") {
			expect(config.sandbox).toMatchObject({
				enabled: true,
				allowUnsandboxedCommands: false,
				filesystem: {
					denyRead: ["~/"],
					allowWrite: [workspace],
					allowRead: [
						".",
						workspace,
						"/tmp/miko-ops-test/automation-memory",
						"/tmp/miko-ops-test",
					],
				},
			});
			expect(config.additionalEnv.NODE_EXTRA_CA_CERTS).toBe(
				"/tmp/miko-ops-test/ca.pem",
			);
		} else if (runnerType === "codex") {
			expect(config.sandboxSettings).toEqual({
				allowWrite: [workspace],
				allowRead: [
					workspace,
					"/tmp/miko-ops-test/automation-memory",
					"/tmp/miko-ops-test",
				],
			});
		} else {
			expect(config.sandboxSettings).toEqual(worker.sdkSandboxSettings);
			expect(config.egressCaCertPath).toBe("/tmp/miko-ops-test/ca.pem");
		}
	});
	it("starts an isolated plain workspace with Linear tools even when no repositories exist", async () => {
		const { worker, runner, request, mcpConfig } = fixture();
		await worker.startDirectRepositoryTask(request);
		expect(worker.gitService.createGitWorktree).toHaveBeenCalledWith(
			expect.objectContaining({ id: "run-1", identifier: "AUTO-run-1" }),
			[],
			{ workspaceBaseDir: "/tmp/miko-ops-test/automation-workspaces" },
		);
		expect(worker.agentSessionManager.createChatSession).toHaveBeenCalledWith(
			"automation-run-1",
			{
				path: "/tmp/miko-ops-test/automation-workspaces/AUTO-run-1",
				isGitWorktree: false,
			},
			"automation",
			[],
		);
		expect(worker.mcpConfigService.buildMcpConfig).toHaveBeenCalledWith(
			"automation-run-1",
			"ws",
			"automation-run-1",
		);
		expect(worker.createRunnerForType).toHaveBeenCalledWith(
			"codex",
			expect.objectContaining({ model: "gpt-5.5", mcpConfig }),
		);
		expect(runner.start).toHaveBeenCalledWith(
			`# Ops task\n\n${request.instructions}\n\n${AUTOMATION_OPS_COMPLETION_INSTRUCTIONS}`,
		);
	});
	it("preserves the configured operations tool allowlist", async () => {
		const { worker, request } = fixture();
		await worker.startDirectRepositoryTask(request);
		expect(worker.createRunnerForType.mock.calls[0][1].allowedTools).toEqual([
			"Read(**)",
		]);
	});
	it("also runs without a Linear connection and records runner failures", async () => {
		const { worker, runner, request } = fixture(false);
		runner.start.mockRejectedValueOnce(new Error("Runner failed"));
		await worker.startDirectRepositoryTask(request);
		expect(worker.mcpConfigService.buildMcpConfig).not.toHaveBeenCalled();
		await vi.waitFor(() =>
			expect(worker.updateAutomationSession).toHaveBeenCalledWith(
				"automation-run-1",
				{ status: "failed", message: "Runner failed" },
			),
		);
	});
});
