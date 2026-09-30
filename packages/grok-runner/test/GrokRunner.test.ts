import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKAssistantMessage, SDKResultMessage } from "miko-core";
import { describe, expect, it } from "vitest";
import { GrokRunner } from "../src/GrokRunner.js";

function makeTempDir(): string {
	return mkdtempSync(join(tmpdir(), "miko-grok-runner-"));
}

function writeFakeGrok(
	dir: string,
	body: string,
	captureFile = join(dir, "capture.json"),
	appendCapture = false,
): string {
	const script = join(dir, "fake-grok.mjs");
	const captureLine = appendCapture
		? `appendFileSync(${JSON.stringify(captureFile)}, JSON.stringify({ argv, promptFile, promptContents }) + String.fromCharCode(10));`
		: `writeFileSync(${JSON.stringify(captureFile)}, JSON.stringify({ argv, promptFile, promptContents }));`;
	writeFileSync(
		script,
		[
			"#!/usr/bin/env node",
			'import { appendFileSync, readFileSync, writeFileSync } from "node:fs";',
			"const argv = process.argv.slice(2);",
			'const promptFileIdx = argv.indexOf("--prompt-file");',
			"const promptFile = promptFileIdx >= 0 ? argv[promptFileIdx + 1] : undefined;",
			'const promptContents = promptFile ? readFileSync(promptFile, "utf8") : null;',
			captureLine,
			body.trim(),
			"",
		].join("\n"),
		{ mode: 0o755 },
	);
	chmodSync(script, 0o755);
	return script;
}

const sampleOutput = [
	JSON.stringify({
		type: "system",
		subtype: "init",
		session_id: "grok-session-123",
		apiKeySource: "user",
		model: "grok-4.6",
		cwd: "/tmp",
		permissionMode: "default",
		tools: [],
		slash_commands: [],
		mcp_servers: [],
		skills: [],
		uuid: "11111111-1111-1111-1111-111111111111",
	}),
	JSON.stringify({
		type: "assistant",
		session_id: "grok-session-123",
		uuid: "22222222-2222-2222-2222-222222222222",
		parent_tool_use_id: null,
		message: {
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "grok-4.6",
			content: [{ type: "text", text: "Hello from Grok" }],
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 2 },
		},
	}),
	JSON.stringify({
		type: "result",
		subtype: "success",
		session_id: "grok-session-123",
		uuid: "33333333-3333-3333-3333-333333333333",
		is_error: false,
		duration_ms: 12,
		duration_api_ms: 10,
		num_turns: 1,
		result: "Hello from Grok",
		stop_reason: "end_turn",
		total_cost_usd: 0,
		usage: {
			input_tokens: 1,
			output_tokens: 2,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
		},
		modelUsage: {},
		permission_denials: [],
	}),
].join("\n");

describe("GrokRunner", () => {
	it("spawns grok with streaming-messages-json and maps SDK messages", async () => {
		const dir = makeTempDir();
		const captureFile = join(dir, "capture.json");
		const grokPath = writeFakeGrok(
			dir,
			`process.stdout.write(${JSON.stringify(`${sampleOutput}\n`)});`,
			captureFile,
		);
		const messages: unknown[] = [];
		const runner = new GrokRunner({
			grokPath,
			workingDirectory: dir,
			mikoHome: dir,
			model: "grok-4.6",
			maxTurns: 4,
			appendSystemPrompt: "Be brief.",
			onMessage: (message) => {
				messages.push(message);
			},
		});

		const session = await runner.start("Say hello");

		expect(session.sessionId).toBe("grok-session-123");
		expect(session.isRunning).toBe(false);
		expect(runner.supportsStreamingInput).toBe(true);
		expect(runner.isRunning()).toBe(false);
		expect(messages).toEqual(runner.getMessages());

		const capture = JSON.parse(readFileSync(captureFile, "utf8"));
		expect(capture.argv.slice(0, 4)).toEqual([
			"--output-format",
			"streaming-messages-json",
			"--always-approve",
			"--cwd",
		]);
		expect(capture.argv).toContain(dir);
		expect(capture.argv).toContain("--prompt-file");
		expect(capture.argv).toContain("-m");
		expect(capture.argv).toContain("grok-4.6");
		expect(capture.argv).toContain("--max-turns");
		expect(capture.argv).toContain("4");

		expect(capture.promptFile).toEqual(expect.stringContaining("prompt.txt"));
		expect(capture.promptContents).toContain("Be brief.");
		expect(capture.promptContents).toContain("Say hello");

		const allMessages = runner.getMessages();
		expect(allMessages[0]).toMatchObject({
			type: "system",
			subtype: "init",
			session_id: "grok-session-123",
		});

		const assistant = allMessages.find(
			(message) => message.type === "assistant",
		) as SDKAssistantMessage | undefined;
		expect(assistant).toBeDefined();
		expect((assistant?.message.content[0] as { text?: string }).text).toBe(
			"Hello from Grok",
		);

		const result = allMessages.at(-1) as SDKResultMessage;
		expect(result.type).toBe("result");
		expect(result.is_error).toBe(false);
	});

	it("resumes with -r when resumeSessionId is set", async () => {
		const dir = makeTempDir();
		const captureFile = join(dir, "capture.json");
		const grokPath = writeFakeGrok(
			dir,
			`process.stdout.write(${JSON.stringify(`${sampleOutput}\n`)});`,
			captureFile,
		);
		const runner = new GrokRunner({
			grokPath,
			workingDirectory: dir,
			mikoHome: dir,
			resumeSessionId: "grok-session-123",
		});

		await runner.start("Continue");
		const capture = JSON.parse(readFileSync(captureFile, "utf8"));
		expect(capture.argv).toContain("-r");
		expect(capture.argv).toContain("grok-session-123");
	});

	it("buffers mid-turn follow-ups and chains a -r turn without stop()", async () => {
		const dir = makeTempDir();
		const captureFile = join(dir, "capture.jsonl");
		const grokPath = writeFakeGrok(
			dir,
			`
const isResume = argv.includes("-r");
const sessionId = "grok-session-123";
const text = isResume ? "Follow-up done" : "First turn done";
const nl = String.fromCharCode(10);
process.stdout.write(JSON.stringify({
  type: "system", subtype: "init", session_id: sessionId,
  apiKeySource: "user", model: "grok-4.6", cwd: "/tmp",
  permissionMode: "default", tools: [], slash_commands: [],
  mcp_servers: [], skills: [],
  uuid: "11111111-1111-1111-1111-111111111111",
}) + nl);
process.stdout.write(JSON.stringify({
  type: "assistant", session_id: sessionId,
  uuid: "22222222-2222-2222-2222-222222222222",
  parent_tool_use_id: null,
  message: {
    id: "msg_1", type: "message", role: "assistant", model: "grok-4.6",
    content: [{ type: "text", text }],
    stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 2 },
  },
}) + nl);
process.stdout.write(JSON.stringify({
  type: "result", subtype: "success", session_id: sessionId,
  uuid: "33333333-3333-3333-3333-333333333333",
  is_error: false, duration_ms: 12, duration_api_ms: 10, num_turns: 1,
  result: text, stop_reason: "end_turn", total_cost_usd: 0,
  usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  modelUsage: {}, permission_denials: [],
}) + nl);
`,
			captureFile,
			true,
		);

		const results: string[] = [];
		let injected = false;
		const runner = new GrokRunner({
			grokPath,
			workingDirectory: dir,
			mikoHome: dir,
			onMessage: (message) => {
				if (
					!injected &&
					message.type === "system" &&
					(message as { subtype?: string }).subtype === "init"
				) {
					injected = true;
					expect(runner.isStreaming()).toBe(true);
					runner.addStreamMessage("Follow-up from Linear");
				}
				if (message.type === "result" && "result" in message) {
					results.push(String(message.result));
				}
			},
		});

		const session = await runner.startStreaming("First prompt");
		expect(session.isRunning).toBe(false);
		expect(runner.isRunning()).toBe(false);
		expect(injected).toBe(true);
		expect(results).toEqual(["First turn done", "Follow-up done"]);

		const captures = readFileSync(captureFile, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(captures).toHaveLength(2);
		expect(captures[0].promptContents).toContain("First prompt");
		expect(captures[0].argv).not.toContain("-r");
		expect(captures[1].promptContents).toContain("Follow-up from Linear");
		expect(captures[1].argv).toContain("-r");
		expect(captures[1].argv).toContain("grok-session-123");
	});

	it("rejects addStreamMessage when no session is running", () => {
		const runner = new GrokRunner({
			workingDirectory: "/tmp",
			mikoHome: "/tmp",
		});
		expect(() => runner.addStreamMessage("hi")).toThrow(
			/no active Grok session/,
		);
	});
});
