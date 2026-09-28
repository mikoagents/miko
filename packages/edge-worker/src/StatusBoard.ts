import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
	type AgentMessage,
	type LocalLogRecord,
	type MikoAgentSession,
	type MikoAgentSessionEntry,
	subscribeLocalLogs,
} from "miko-core";
import type { AutomationAdapters } from "./automation/AutomationAdapters.js";
import { registerAutomationRoutes } from "./automation/AutomationRoutes.js";
import type { AutomationService } from "./automation/AutomationService.js";
import { BoardHistory, type BoardTask } from "./BoardHistory.js";
import {
	type BoardDefaultsInfo,
	type BoardRepositoryInfo,
	type BoardWorkspaceInfo,
	buildBoardStatus,
	openBoardDirectory,
	openPathInFileManager,
} from "./BoardPaths.js";
import { listBoardSkills, resolveAllowedBoardSkill } from "./BoardSkills.js";

const MAX_TASKS = 60;
const MAX_LOGS = 650;
const MAX_TEXT = 4000;

export interface BoardLog {
	at: number;
	source: string;
	level: "debug" | "info" | "warning" | "error";
	kind: "activity" | "tool" | "output" | "lifecycle" | "service";
	text: string;
	sessionId?: string;
	issue?: string;
	/** Opaque correlation within a runner session; never inferred from log order. */
	toolCallId?: string;
}

export interface BoardOptions {
	automations?: { service: AutomationService; adapters: AutomationAdapters };
	getSessionTitle?(sessionId: string): string | undefined;
	historyPath?: string;
	onSessionRemoved?(listener: (session: MikoAgentSession) => void): () => void;
	getSessions(): MikoAgentSession[];
	getEntries(sessionId: string): MikoAgentSessionEntry[];
	getStatus(): "idle" | "busy";
	getRepositoryName(id: string): string;
	getLinearWorkspaceSlug?(repositoryId: string): string | undefined;
	/** Configured repositories for Status (same set Automations uses). */
	listRepositories?(): BoardRepositoryInfo[];
	/** Safe install defaults (runner + models) for Status. */
	getDefaults?(): BoardDefaultsInfo;
	/** Linear workspaces for Status (names/slugs/flags only). */
	listWorkspaces?(): BoardWorkspaceInfo[];
	/** Absolute Miko home (config/data). Required for status/open-directory APIs. */
	mikoHome?: string;
	version?: string | null;
	releaseDir?: string;
	/**
	 * When set (non-empty), remote/proxied board access is allowed with this token.
	 * Local loopback still works without presenting the token. Wire from MIKO_BOARD_TOKEN.
	 */
	accessToken?: string;
}

export function redactBoardText(value: string): string {
	return (
		value
			// biome-ignore lint/suspicious/noControlCharactersInRegex: Strip ANSI color sequences from runner output.
			.replace(/\x1b\[[0-9;]*m/g, "")
			.replace(
				/\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|lin_(?:api|oauth)_[\w-]+|sk-[\w-]{12,})\b/g,
				"[REDACTED]",
			)
			.replace(/\bBearer\s+[\w.\-+/=]+/gi, "Bearer [REDACTED]")
			.replace(
				/(\b(?:[\w]*(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|webhook[_-]?secret|password|api[_-]?key)|(?:GH|GITHUB|LINEAR|SLACK)[_-]?TOKEN|token|secret)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,
				"$1[REDACTED]",
			)
			.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@")
	);
}

function text(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "[Unserializable output]";
	}
}

function bounded(value: string): string {
	const clean = redactBoardText(value);
	return clean.length > MAX_TEXT
		? `${clean.slice(0, MAX_TEXT)}\n… [entry truncated]`
		: clean;
}

function toolCallId(id: unknown, runner: unknown): string | undefined {
	if (typeof id !== "string" || !id || typeof runner !== "string" || !runner)
		return;
	return createHash("sha256")
		.update(JSON.stringify([runner, id]))
		.digest("hex");
}

/** Explicit output allowlist: never forward prompts, reasoning, or SDK system data. */
export function boardMessageLogs(
	message: AgentMessage,
	at: number,
): BoardLog[] {
	const logs: BoardLog[] = [];
	const add = (
		value: string,
		kind: BoardLog["kind"],
		error = false,
		id?: string,
	) => {
		if (value || kind === "output")
			logs.push({
				at,
				source: "agent",
				level: error ? "error" : "info",
				kind,
				text: bounded(value),
				...(id ? { toolCallId: id } : {}),
			});
	};
	if (message.type === "assistant" || message.type === "user") {
		const content = message.message.content;
		if (typeof content === "string") {
			if (message.type === "assistant") add(content, "activity");
			return logs;
		}
		for (const block of content) {
			if (message.type === "assistant" && block.type === "text")
				add(block.text, "activity");
			else if (message.type === "assistant" && block.type === "tool_use")
				add(
					`${block.name}\n${text(block.input)}`,
					"tool",
					false,
					toolCallId(block.id, message.session_id),
				);
			else if (block.type === "tool_result") {
				const output =
					typeof block.content === "string"
						? block.content
						: (block.content
								?.filter((part) => part.type === "text")
								.map((part) => part.text)
								.join("\n") ?? "");
				add(
					output,
					"output",
					Boolean(block.is_error),
					toolCallId(block.tool_use_id, message.session_id),
				);
			}
		}
	} else if (message.type === "result") {
		const body =
			"result" in message ? message.result : message.errors?.join("\n");
		add(
			body || (message.is_error ? "Turn failed" : "Turn completed"),
			"lifecycle",
			message.is_error,
		);
	}
	return logs;
}

function savedEntryLog(
	entry: MikoAgentSessionEntry,
	fallbackTime: number,
): BoardLog | undefined {
	const toolResult =
		entry.type === "user" && Boolean(entry.metadata?.toolUseId);
	if (entry.type !== "assistant" && entry.type !== "result" && !toolResult)
		return;
	const toolCall =
		entry.type === "assistant" && Boolean(entry.metadata?.toolName);
	const content =
		toolCall && entry.metadata?.toolInput !== undefined
			? `${entry.metadata.toolName}\n${text(entry.metadata.toolInput)}`
			: entry.content;
	if (!content && !toolResult) return;
	return {
		at: entry.metadata?.timestamp ?? fallbackTime,
		source: "agent",
		level:
			entry.metadata?.isError ||
			entry.metadata?.toolResultError ||
			entry.metadata?.sdkError
				? "error"
				: "info",
		kind: toolResult
			? "output"
			: toolCall
				? "tool"
				: entry.type === "result"
					? "lifecycle"
					: "activity",
		text: bounded(content),
	};
}

function outputKey(runnerSessionId: string, log: BoardLog): string {
	return JSON.stringify([runnerSessionId, log.kind, log.text]);
}

/** Live runners plus a bounded, persistent archive of removed sessions. */
export class StatusBoard {
	private history: BoardHistory;
	private unsubscribeRemoval?: () => void;
	private serviceLogs: BoardLog[] = [];
	private messageTimes = new WeakMap<AgentMessage, number>();
	private observed = new Map<
		string,
		{
			runner: MikoAgentSession["agentRunner"];
			running: boolean;
			startedAt: number;
			seen: boolean;
		}
	>();
	private unsubscribe: () => void;

	constructor(private options: BoardOptions) {
		this.history = new BoardHistory(options.historyPath, bounded);
		this.unsubscribe = subscribeLocalLogs((record) => this.recordLog(record));
		this.unsubscribeRemoval = options.onSessionRemoved?.((session) => {
			try {
				const snapshot = this.liveSnapshot([session]);
				const task = snapshot.tasks[0];
				if (task)
					this.history.add(
						{ ...task, reason: "Archived after session cleanup." },
						snapshot.logs.filter(
							(log) => log.sessionId === session.id && log.source === "agent",
						),
					);
			} catch {
				this.history.warning = "A removed task could not be archived.";
			}
		});
	}

	ready(): Promise<void> {
		return this.history.ready();
	}
	historyLogs(id: string): BoardLog[] {
		return this.history.logs(id);
	}
	async close(): Promise<void> {
		this.unsubscribeRemoval?.();
		this.unsubscribe();
		await this.history.flush();
		this.serviceLogs = [];
		this.observed.clear();
	}

	private recordLog(record: LocalLogRecord): void {
		this.serviceLogs.push({
			at: record.timestamp,
			source: "miko",
			level: record.level,
			kind: "service",
			text: bounded(`[${record.component}] ${record.message}`),
			sessionId: record.context.sessionId,
			issue: record.context.issueIdentifier,
		});
		if (this.serviceLogs.length > MAX_LOGS)
			this.serviceLogs.splice(0, this.serviceLogs.length - MAX_LOGS);
	}

	snapshot() {
		const live = this.liveSnapshot();
		const ids = new Set(
			this.options.getSessions().map((session) => session.id),
		);
		return {
			...live,
			tasks: [
				...live.tasks,
				...this.history.tasks().filter((task) => !ids.has(task.id)),
			].sort(
				(a, b) =>
					Number(b.status === "running") - Number(a.status === "running") ||
					b.lastActivityAt - a.lastActivityAt,
			),
			warnings: this.history.warning ? [this.history.warning] : [],
		};
	}

	private liveSnapshot(sessions = this.options.getSessions()) {
		const now = Date.now();
		const ids = new Set(
			this.options.getSessions().map((session) => session.id),
		);
		for (const id of this.observed.keys())
			if (!ids.has(id)) this.observed.delete(id);
		// Prioritize real live runners before applying the retention limit.
		const active = sessions
			.map((session) => ({
				session,
				running: Boolean(session.agentRunner?.isRunning()),
			}))
			.sort(
				(a, b) =>
					Number(b.running) - Number(a.running) ||
					b.session.updatedAt - a.session.updatedAt,
			)
			.slice(0, MAX_TASKS);
		const logs = [...this.serviceLogs];
		const tasks: BoardTask[] = active.map(({ session, running }) => {
			const runner = session.agentRunner;
			const previous = this.observed.get(session.id);
			const startedAt =
				running && previous && (!previous.running || previous.runner !== runner)
					? now
					: (previous?.startedAt ?? session.updatedAt);
			this.observed.set(session.id, { runner, running, startedAt, seen: true });
			const messages = runner?.getMessages() ?? [];
			let lastActivityAt = session.updatedAt;
			// The manager retains previous turns even when a resumed runner starts
			// with an empty message buffer. Saved output is the history source.
			const savedCounts = new Map<string, number>();
			const savedEntries = this.options.getEntries(session.id).slice(-MAX_LOGS);
			for (const entry of savedEntries) {
				const log = savedEntryLog(entry, session.updatedAt);
				if (!log) continue;
				const runnerSessionId =
					entry.codexSessionId ??
					entry.claudeSessionId ??
					entry.geminiSessionId ??
					entry.cursorSessionId ??
					entry.opencodeSessionId ??
					entry.grokSessionId ??
					"";
				const key = outputKey(runnerSessionId, log);
				if (log.kind === "tool" || log.kind === "output") {
					log.toolCallId = toolCallId(
						entry.metadata?.toolUseId,
						runnerSessionId,
					);
				}
				savedCounts.set(key, (savedCounts.get(key) ?? 0) + 1);
				lastActivityAt = Math.max(lastActivityAt, log.at);
				logs.push({
					...log,
					sessionId: session.id,
					issue: session.issue?.identifier,
				});
			}
			for (const message of messages.slice(-160)) {
				let at = this.messageTimes.get(message);
				if (at === undefined) {
					at = previous?.seen ? now : session.updatedAt;
					this.messageTimes.set(message, at);
				}
				const entries = boardMessageLogs(message, at);
				for (const entry of entries) {
					const runnerSessionId =
						"session_id" in message ? (message.session_id ?? "") : "";
					const key = outputKey(runnerSessionId, entry);
					const savedCount = savedCounts.get(key) ?? 0;
					if (savedCount > 0) {
						savedCounts.set(key, savedCount - 1);
						continue;
					}
					lastActivityAt = Math.max(lastActivityAt, at);
					logs.push({
						...entry,
						sessionId: session.id,
						issue: session.issue?.identifier,
					});
				}
			}
			const lastResult = [...messages]
				.reverse()
				.find((message) => message.type === "result");
			const status = running
				? "running"
				: session.status === "error" || lastResult?.is_error
					? "error"
					: session.status === "complete" || lastResult
						? "completed"
						: "idle";
			const workspaceSlugs = new Set(
				session.repositories.map((repo) =>
					this.options.getLinearWorkspaceSlug?.(repo.repositoryId),
				),
			);
			const workspaceSlug =
				(!session.issueContext ||
					session.issueContext.trackerId === "linear") &&
				workspaceSlugs.size === 1
					? [...workspaceSlugs][0]
					: undefined;
			return {
				id: session.id,
				linearWorkspaceSlug: workspaceSlug ? bounded(workspaceSlug) : undefined,
				issue: bounded(
					session.issue?.identifier ??
						session.issueContext?.issueIdentifier ??
						"",
				),
				title: bounded(
					session.issue?.title ??
						this.options.getSessionTitle?.(session.id) ??
						"Chat session",
				),
				status,
				reason: running
					? "This session's runner is executing."
					: "This session's runner is not executing.",
				model: bounded(session.metadata?.model ?? ""),
				reasoningEffort: bounded(session.metadata?.reasoningEffort ?? ""),
				fastMode: session.metadata?.fastMode,
				createdAt: session.createdAt,
				lastActivityAt,
				turnStartedAt: startedAt,
				quiet: running && now - lastActivityAt > 120000,
				repositories: session.repositories.map((repo) =>
					bounded(this.options.getRepositoryName(repo.repositoryId)),
				),
			};
		});
		return {
			app: "miko-board",
			collectedAt: new Date(now).toISOString(),
			stale: false,
			service: { online: true, status: this.options.getStatus() },
			tasks,
			logs: logs.sort((a, b) => a.at - b.at).slice(-MAX_LOGS),
			warnings: [],
		};
	}
}

const BOARD_TOKEN_COOKIE = "miko_board_token";

/** Trimmed non-empty access token, or undefined when remote auth is disabled. */
export function configuredBoardToken(
	accessToken: string | undefined,
): string | undefined {
	const token = accessToken?.trim();
	return token ? token : undefined;
}

/** Constant-time string compare for board tokens (equal-length buffers only). */
export function boardTokensEqual(expected: string, provided: string): boolean {
	const left = Buffer.from(expected);
	const right = Buffer.from(provided);
	if (left.length !== right.length) {
		timingSafeEqual(left, left);
		return false;
	}
	return timingSafeEqual(left, right);
}

function headerValue(value: string | string[] | undefined): string | undefined {
	if (Array.isArray(value)) return value[0];
	return value;
}

function boardCookieToken(
	cookieHeader: string | string[] | undefined,
): string | undefined {
	const raw = Array.isArray(cookieHeader)
		? cookieHeader.join("; ")
		: cookieHeader;
	if (!raw) return;
	for (const part of raw.split(";")) {
		const idx = part.indexOf("=");
		if (idx === -1) continue;
		const key = part.slice(0, idx).trim();
		if (key !== BOARD_TOKEN_COOKIE) continue;
		const value = part.slice(idx + 1).trim();
		try {
			return decodeURIComponent(value);
		} catch {
			return value;
		}
	}
	return;
}

function boardBearerToken(
	authorization: string | string[] | undefined,
): string | undefined {
	const value = headerValue(authorization)?.trim();
	if (!value) return;
	const match = /^Bearer\s+(\S+)$/i.exec(value);
	return match?.[1];
}

/** True when the request presents a valid Bearer or cookie board token. */
export function isBoardTokenAuthenticated(
	request: FastifyRequest,
	accessToken: string,
): boolean {
	const bearer = boardBearerToken(request.headers.authorization);
	if (bearer !== undefined && boardTokensEqual(accessToken, bearer))
		return true;
	const cookie = boardCookieToken(request.headers.cookie);
	return cookie !== undefined && boardTokensEqual(accessToken, cookie);
}

function requestUsesHttps(request: FastifyRequest): boolean {
	const proto = headerValue(request.headers["x-forwarded-proto"])
		?.split(",")[0]
		?.trim()
		.toLowerCase();
	if (proto === "https") return true;
	if (proto === "http") return false;
	return Boolean((request.raw.socket as { encrypted?: boolean }).encrypted);
}

/** Public request origin using forwarded proto/host when present. */
export function resolveBoardRequestOrigin(
	request: FastifyRequest,
): string | null {
	const forwardedHost = headerValue(request.headers["x-forwarded-host"])
		?.split(",")[0]
		?.trim();
	const host = forwardedHost || headerValue(request.headers.host);
	if (!host) return null;
	const scheme = requestUsesHttps(request) ? "https" : "http";
	try {
		return new URL(`${scheme}://${host}`).origin;
	} catch {
		return null;
	}
}

function setBoardTokenCookie(
	reply: {
		header: (name: string, value: string | number | string[]) => unknown;
	},
	token: string,
	secure: boolean,
): void {
	const parts = [
		`${BOARD_TOKEN_COOKIE}=${encodeURIComponent(token)}`,
		"Path=/board",
		"HttpOnly",
		"SameSite=Lax",
	];
	if (secure) parts.push("Secure");
	reply.header("Set-Cookie", parts.join("; "));
}

function boardLoginPage(error?: string): string {
	const message = error
		? `<p class="error">${error}</p>`
		: "<p>Enter the board access token to continue.</p>";
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Miko board login</title>
<style>
body{font-family:system-ui,sans-serif;background:#0b0f14;color:#e8eef7;margin:0;min-height:100vh;display:grid;place-items:center}
main{width:min(24rem,100%);padding:1.5rem;border:1px solid #243041;border-radius:12px;background:#121821}
h1{font-size:1.1rem;margin:0 0 .75rem}
p{margin:0 0 1rem;color:#9db0c7;font-size:.9rem}
.error{color:#ff8e8e}
label{display:block;font-size:.8rem;margin-bottom:.35rem;color:#9db0c7}
input{width:100%;box-sizing:border-box;padding:.65rem .75rem;border-radius:8px;border:1px solid #314257;background:#0b0f14;color:inherit}
button{margin-top:1rem;width:100%;padding:.7rem;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer}
</style>
</head>
<body>
<main>
<h1>Miko status board</h1>
${message}
<form method="post" action="/board/login" autocomplete="current-password">
<label for="token">Access token</label>
<input id="token" name="token" type="password" required autofocus/>
<button type="submit">Continue</button>
</form>
</main>
</body>
</html>`;
}

function boardPathname(url: string): string {
	try {
		return new URL(url, "http://127.0.0.1").pathname;
	} catch {
		return url.split("?")[0] ?? url;
	}
}

function isBoardHtmlNavigation(request: FastifyRequest): boolean {
	if (request.method !== "GET" && request.method !== "HEAD") return false;
	const path = boardPathname(request.url);
	return path === "/board" || path === "/board/";
}

function isBoardLoginPost(request: FastifyRequest): boolean {
	return (
		request.method === "POST" && boardPathname(request.url) === "/board/login"
	);
}

/** Check the socket, not Fastify's proxy-trusting request.ip. */
export function isLocalBoardRequest(request: FastifyRequest): boolean {
	const address = request.raw.socket.remoteAddress;
	if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address ?? ""))
		return false;
	for (const header of [
		"forwarded",
		"x-forwarded-for",
		"x-forwarded-host",
		"cf-connecting-ip",
	]) {
		if (request.headers[header] !== undefined) return false;
	}
	try {
		const url = new URL(`http://${request.headers.host}`);
		if (
			!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
			url.username ||
			url.password
		)
			return false;
		if (request.headers.origin && request.headers.origin !== url.origin)
			return false;
		return (
			!request.headers["sec-fetch-site"] ||
			request.headers["sec-fetch-site"] !== "cross-site"
		);
	} catch {
		return false;
	}
}

/** Registers on the existing application server; no listener or subprocess is created. */
export function registerStatusBoard(
	app: FastifyInstance,
	options: BoardOptions,
	assetsDirectory = new URL("./board/", import.meta.url),
): StatusBoard {
	const board = new StatusBoard(options);
	const clients = new Set<ServerResponse>();
	let timer: ReturnType<typeof setInterval> | undefined;
	const broadcast = () => {
		try {
			const data = `data: ${JSON.stringify(board.snapshot())}\n\n`;
			for (const client of clients) {
				if (client.writableLength > 2 * 1024 * 1024) client.destroy();
				else client.write(data);
			}
		} catch {
			for (const client of clients)
				client.write("event: unavailable\ndata: {}\n\n");
		}
	};
	const routes = new Map([
		["/board", ["index.html", "text/html; charset=utf-8"]],
		["/board/", ["index.html", "text/html; charset=utf-8"]],
		["/board/assets/app.js", ["app.js", "text/javascript; charset=utf-8"]],
		["/board/assets/app.css", ["app.css", "text/css; charset=utf-8"]],
		[
			"/board/assets/app.js.LEGAL.txt",
			["app.js.LEGAL.txt", "text/plain; charset=utf-8"],
		],
	]);
	const accessToken = configuredBoardToken(options.accessToken);
	app.register(async (scoped) => {
		await board.ready();
		scoped.addContentTypeParser(
			"application/x-www-form-urlencoded",
			{ parseAs: "string" },
			(_request, body, done) => {
				try {
					done(null, Object.fromEntries(new URLSearchParams(String(body))));
				} catch (error) {
					done(error as Error, undefined);
				}
			},
		);
		scoped.addHook("onRequest", async (request, reply) => {
			reply
				.header("Cache-Control", "no-store")
				.header("X-Content-Type-Options", "nosniff")
				.header("Referrer-Policy", "no-referrer")
				.header(
					"Content-Security-Policy",
					"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
				);
			if (isLocalBoardRequest(request)) return undefined;
			if (!accessToken)
				return reply.code(403).send({ error: "Local access only" });
			if (isBoardTokenAuthenticated(request, accessToken)) return undefined;
			if (isBoardHtmlNavigation(request) || isBoardLoginPost(request))
				return undefined;
			return reply
				.code(401)
				.header("WWW-Authenticate", 'Bearer realm="miko-board"')
				.send({ error: "Authentication required" });
		});
		const serveBoardHtml = async (
			request: FastifyRequest<{ Querystring: { token?: string } }>,
			reply: {
				type: (value: string) => {
					send: (body: unknown) => unknown;
				};
				header: (name: string, value: string | number | string[]) => unknown;
				redirect: (url: string, statusCode?: number) => unknown;
				code: (status: number) => {
					type: (value: string) => { send: (body: unknown) => unknown };
				};
			},
		) => {
			const path = boardPathname(request.url);
			const queryToken =
				typeof request.query?.token === "string"
					? request.query.token
					: undefined;
			if (accessToken && queryToken !== undefined) {
				if (boardTokensEqual(accessToken, queryToken)) {
					setBoardTokenCookie(reply, accessToken, requestUsesHttps(request));
					return reply.redirect(path, 302);
				}
				return reply
					.code(401)
					.type("text/html; charset=utf-8")
					.send(boardLoginPage("Invalid access token."));
			}
			const allowed =
				isLocalBoardRequest(request) ||
				(accessToken !== undefined &&
					isBoardTokenAuthenticated(request, accessToken));
			if (!allowed) {
				return reply.type("text/html; charset=utf-8").send(boardLoginPage());
			}
			return reply
				.type("text/html; charset=utf-8")
				.send(await readFile(new URL("index.html", assetsDirectory)));
		};
		scoped.get("/board", serveBoardHtml);
		scoped.get("/board/", serveBoardHtml);
		scoped.post<{ Body: { token?: string } }>(
			"/board/login",
			async (request, reply) => {
				if (!accessToken)
					return reply.code(403).send({ error: "Local access only" });
				const provided =
					typeof request.body?.token === "string" ? request.body.token : "";
				if (!boardTokensEqual(accessToken, provided)) {
					return reply
						.code(401)
						.type("text/html; charset=utf-8")
						.send(boardLoginPage("Invalid access token."));
				}
				setBoardTokenCookie(reply, accessToken, requestUsesHttps(request));
				return reply.redirect("/board/", 302);
			},
		);
		for (const [url, [file, type]] of routes) {
			if (url === "/board" || url === "/board/") continue;
			scoped.get(url, async (_request, reply) =>
				reply.type(type!).send(await readFile(new URL(file!, assetsDirectory))),
			);
		}
		if (options.automations)
			registerAutomationRoutes(
				scoped,
				options.automations.service,
				options.automations.adapters,
				resolveBoardRequestOrigin,
			);
		scoped.get("/board/api/snapshot", async () => board.snapshot());
		scoped.get<{ Params: { sessionId: string } }>(
			"/board/api/history/:sessionId",
			async (request) => ({
				logs: board.historyLogs(request.params.sessionId),
			}),
		);
		const requireMikoHome = (reply: {
			code: (status: number) => { send: (body: unknown) => unknown };
		}) => {
			if (options.mikoHome) return options.mikoHome;
			reply.code(503).send({ error: "Miko home is not configured" });
			return null;
		};
		const requireSameOriginJson = (
			request: FastifyRequest,
			reply: {
				code: (status: number) => { send: (body: unknown) => unknown };
			},
		) => {
			const origin = resolveBoardRequestOrigin(request);
			if (
				!origin ||
				request.headers.origin !== origin ||
				!request.headers["content-type"]?.startsWith("application/json")
			) {
				reply.code(403).send({ error: "Same-origin JSON requests required" });
				return false;
			}
			return true;
		};
		scoped.get("/board/api/status", async (_request, reply) => {
			const mikoHome = requireMikoHome(reply);
			if (!mikoHome) return;
			return buildBoardStatus({
				mikoHome,
				version: options.version,
				releaseDir: options.releaseDir,
				getStatus: options.getStatus,
				getAutomationCount: options.automations
					? () =>
							options
								.automations!.service.list()
								.definitions.filter((d) => !d.archived).length
					: undefined,
				repositories: options.listRepositories?.() ?? [],
				defaults: options.getDefaults?.(),
				workspaces: options.listWorkspaces?.(),
			});
		});
		scoped.get("/board/api/skills", async (_request, reply) => {
			const mikoHome = requireMikoHome(reply);
			if (!mikoHome) return;
			const skills = await listBoardSkills(mikoHome);
			return { skills };
		});
		scoped.post<{ Body: { id?: string } }>(
			"/board/api/open-directory",
			async (request, reply) => {
				if (!requireSameOriginJson(request, reply)) return;
				const mikoHome = requireMikoHome(reply);
				if (!mikoHome) return;
				const id =
					typeof request.body?.id === "string" ? request.body.id.trim() : "";
				if (!id)
					return reply.code(400).send({ error: "Directory id is required" });
				const result = await openBoardDirectory(
					id,
					mikoHome,
					options.releaseDir,
				);
				if (!result.ok) return reply.code(400).send({ error: result.error });
				return result;
			},
		);
		scoped.post<{
			Body: { source?: string; name?: string; repository?: string };
		}>("/board/api/open-skill", async (request, reply) => {
			if (!requireSameOriginJson(request, reply)) return;
			const mikoHome = requireMikoHome(reply);
			if (!mikoHome) return;
			const source =
				typeof request.body?.source === "string"
					? request.body.source.trim()
					: "";
			const name =
				typeof request.body?.name === "string" ? request.body.name.trim() : "";
			const repository =
				typeof request.body?.repository === "string"
					? request.body.repository.trim()
					: undefined;
			if (!source || !name)
				return reply
					.code(400)
					.send({ error: "Skill source and name are required" });
			const allowed = resolveAllowedBoardSkill(
				mikoHome,
				source,
				name,
				repository,
			);
			if (!allowed)
				return reply.code(400).send({ error: "Skill path is not allowlisted" });
			const result = await openPathInFileManager(allowed.path);
			return { ok: true, ...result };
		});
		scoped.get("/board/events", (request, reply) => {
			for (const [name, value] of Object.entries(reply.getHeaders())) {
				if (value !== undefined) reply.raw.setHeader(name, value);
			}
			reply.raw.writeHead(200, {
				"Content-Type": "text/event-stream; charset=utf-8",
				Connection: "keep-alive",
			});
			reply.hijack();
			const response = reply.raw;
			clients.add(response);
			response.write("retry: 3000\n\n");
			broadcast();
			if (!timer) {
				timer = setInterval(broadcast, 2000);
				timer.unref();
			}
			const cleanup = () => {
				clients.delete(response);
				if (!clients.size && timer) {
					clearInterval(timer);
					timer = undefined;
				}
			};
			response.on("close", cleanup);
			request.raw.on("error", cleanup);
		});
	});
	// End SSE before Fastify waits for open responses to drain.
	app.addHook("preClose", async () => {
		if (timer) clearInterval(timer);
		for (const client of clients) client.end();
		clients.clear();
		await board.close();
	});
	return board;
}
