export const runLabels = {
	dispatching: "Dispatching",
	waiting_session: "Waiting for agent",
	running: "Running",
	awaiting_input: "Needs your input",
	succeeded: "Succeeded",
	failed: "Failed",
	skipped: "Skipped",
	uncertain: "Needs review",
};
export const statusColors = {
	scheduled: "green",
	running: "blue",
	dispatching: "blue",
	waiting_session: "blue",
	succeeded: "green",
	failed: "red",
	uncertain: "amber",
	awaiting_input: "amber",
	missed: "amber",
};
export const RUNNER_LABELS = {
	claude: "Claude Code",
	gemini: "Gemini",
	codex: "Codex",
	cursor: "Cursor",
	opencode: "OpenCode",
	grok: "Grok",
};
/** Pull legacy [agent]/[model] tags from instructions when schema fields are unset. */
export function parseRunnerModelFromInstructions(instructions = "") {
	const runner = instructions
		.match(/\[agent\s*=([^\]]+)\]/i)?.[1]
		?.trim()
		?.toLowerCase();
	const model = instructions.match(/\[model\s*=([^\]]+)\]/i)?.[1]?.trim();
	return {
		runner: runner && RUNNER_LABELS[runner] ? runner : "",
		model: model || "",
	};
}
/** Prefer schema model, then instruction tags, then runner default, else "Default". */
export function resolveAutomationModel(definition, options = {}) {
	const explicit = definition?.model?.trim();
	if (explicit) return explicit;
	const fromTags = parseRunnerModelFromInstructions(definition?.instructions);
	if (fromTags.model) return fromTags.model;
	const runner =
		definition?.runner || fromTags.runner || options.defaultRunner || "";
	const fallback =
		(runner && options.defaultModels?.[runner]) ||
		(options.defaultRunner && options.defaultModels?.[options.defaultRunner]);
	return fallback || "Default";
}
export function automationRepositoryIds(definition) {
	const fromArray = (definition?.repositoryIds || []).filter(Boolean);
	if (fromArray.length) return [...new Set(fromArray)];
	if (definition?.repositoryId) return [definition.repositoryId];
	return [];
}
/** Compact list-row label: "A", "A, B", or "A +2". */
export function formatRepositoryNames(definition, repositories = []) {
	if (definition?.target?.kind === "direct_ops") return "No repository";
	const ids = automationRepositoryIds(definition);
	const names = ids.map(
		(id) => repositories.find((repository) => repository.id === id)?.name || id,
	);
	if (!names.length) return "No repository";
	if (names.length === 1) return names[0];
	if (names.length === 2) return `${names[0]}, ${names[1]}`;
	return `${names[0]} +${names.length - 1}`;
}
export function formatDate(value, timezone, compact = false) {
	if (!value) return "—";
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: compact ? "short" : "medium",
		timeStyle: "short",
		timeZone: timezone,
	}).format(new Date(value));
}
export function scheduleLabel(definition) {
	const s = definition.schedule;
	if (s.kind === "once") return "One-time task";
	if (s.kind === "cron") return s.expression;
	if (s.kind === "daily") return `Every day at ${s.time}`;
	const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	return `${s.days.map((day) => names[day]).join(", ")} at ${s.time}`;
}
export function formFromDefinition(definition, options, kind = "daily") {
	const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const isOps = definition?.target?.kind === "direct_ops";
	const selectedIds = isOps
		? []
		: automationRepositoryIds(definition).length
			? automationRepositoryIds(definition).filter((id) =>
					options.repositories.some((repository) => repository.id === id),
				)
			: options.repositories[0]
				? [options.repositories[0].id]
				: [];
	const selected = selectedIds
		.map((id) =>
			options.repositories.find((repository) => repository.id === id),
		)
		.filter(Boolean);
	const at =
		definition?.schedule.kind === "once"
			? new Date(definition.schedule.at)
			: new Date(Date.now() + 3600000);
	const fromTags = parseRunnerModelFromInstructions(definition?.instructions);
	return formWithRepositories(
		{
			name: definition?.name || "",
			instructions: (definition?.instructions || "")
				.replace(/\[(?:agent|model)\s*=[^\]]*\]\s*/gi, "")
				.trim(),
			repositoryIds: selectedIds,
			target: definition?.target.kind || "direct_repository",
			workspaceId: definition?.target.workspaceId || "",
			teamId: definition?.target.teamId || "",
			projectId: definition?.target.projectId || "",
			kind: definition?.schedule.kind || kind,
			time: definition?.schedule.time || "09:00",
			days: definition?.schedule.days || [1, 2, 3, 4, 5],
			at: new Date(at.getTime() - at.getTimezoneOffset() * 60000)
				.toISOString()
				.slice(0, 16),
			expression: definition?.schedule.expression || "0 9 * * *",
			timezone:
				definition?.schedule.kind === "once"
					? localZone
					: definition?.timezone || localZone,
			enabled: definition?.enabled ?? true,
			runner: definition?.runner || fromTags.runner || "",
			model: definition?.model || fromTags.model || "",
		},
		selected,
	);
}
/** Keep Linear workspace/team in sync with the selected repository set. */
export function formWithRepositories(form, repositories) {
	const selected = repositories || [];
	const workspaceIds = [
		...new Set(
			selected.map((repository) => repository.workspaceId).filter(Boolean),
		),
	];
	const workspaceId = workspaceIds.length === 1 ? workspaceIds[0] : "";
	const sameWorkspace = !!workspaceId && workspaceId === form.workspaceId;
	return {
		...form,
		repositoryIds: selected.map((repository) => repository.id),
		workspaceId,
		teamId: sameWorkspace ? form.teamId : "",
		projectId: sameWorkspace ? form.projectId : "",
	};
}
/** @deprecated Prefer formWithRepositories; kept for call sites toggling one repo. */
export function formWithRepository(form, repository) {
	if (!repository) return formWithRepositories(form, []);
	const current = new Set(form.repositoryIds || []);
	if (current.has(repository.id) && current.size === 1)
		return formWithRepositories(form, [repository]);
	return formWithRepositories(form, [repository]);
}
export function formWithTeam(form, teamId) {
	return {
		...form,
		teamId,
		projectId: teamId === form.teamId ? form.projectId : "",
	};
}
export function formWithTarget(form, target, options) {
	const selected =
		target === "direct_ops"
			? []
			: (form.repositoryIds || [])
					.map((id) =>
						options.repositories.find((repository) => repository.id === id),
					)
					.filter(Boolean);
	const repositories =
		target === "direct_ops"
			? []
			: selected.length
				? selected
				: options.repositories[0]
					? [options.repositories[0]]
					: [];
	return formWithRepositories({ ...form, target }, repositories);
}
export function scheduleFromForm(form) {
	if (form.kind === "once") {
		const at = new Date(form.at);
		if (!form.at || !Number.isFinite(at.getTime()))
			throw new Error("Choose a date and time.");
		return { kind: "once", at: at.toISOString() };
	}
	if (form.kind === "cron")
		return { kind: "cron", expression: form.expression };
	if (form.kind === "weekly" && !form.days.length)
		throw new Error("Choose at least one weekday.");
	return {
		kind: form.kind,
		time: form.time,
		...(form.kind === "weekly"
			? { days: [...form.days].sort((a, b) => a - b) }
			: {}),
	};
}
export function inputFromForm(form) {
	const target =
		form.target === "direct_ops"
			? { kind: "direct_ops" }
			: form.target === "direct_repository"
				? { kind: "direct_repository" }
				: form.target === "github_issue"
					? { kind: "github_issue" }
					: {
							kind: "linear_issue",
							workspaceId: form.workspaceId,
							teamId: form.teamId,
							...(form.projectId ? { projectId: form.projectId } : {}),
						};
	const input = {
		name: form.name.trim(),
		instructions: form.instructions.trim(),
		timezone:
			form.kind === "once"
				? Intl.DateTimeFormat().resolvedOptions().timeZone
				: form.timezone,
		enabled: form.enabled,
		schedule: scheduleFromForm(form),
		target,
	};
	if (form.target !== "direct_ops") {
		const repositoryIds = [
			...new Set((form.repositoryIds || []).filter(Boolean)),
		];
		if (repositoryIds.length) input.repositoryIds = repositoryIds;
	}
	if (form.runner) input.runner = form.runner;
	if (form.model?.trim()) input.model = form.model.trim();
	return input;
}
export function modelChoices(options, runner) {
	const selectedRunner = runner || options.defaultRunner;
	const suggestions = selectedRunner
		? options.modelSuggestions?.[selectedRunner] || []
		: Object.values(options.modelSuggestions || {}).flat();
	const defaults = options.defaultModels || {};
	const preferred = selectedRunner ? defaults[selectedRunner] : undefined;
	const values = [];
	const seen = new Set();
	for (const value of [preferred, ...suggestions].filter(Boolean)) {
		if (seen.has(value)) continue;
		seen.add(value);
		values.push(value);
	}
	return values;
}
export async function automationApi(path = "", method = "GET", body, signal) {
	const response = await fetch(`/board/api/automations${path}`, {
		method,
		cache: "no-store",
		headers: body === undefined ? {} : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal,
	});
	const data = await response.json();
	if (!response.ok)
		throw new Error(data.error || "Request failed. Please try again.");
	return data;
}

/** Map a free-text model id to a brand icon kind used by the board. */
export function modelIconKind(model = "") {
	const value = String(model).trim().toLowerCase();
	if (!value) return "generic";
	if (/composer|cursor/.test(value)) return "cursor";
	if (/codex/.test(value)) return "codex";
	if (/(^|\/|-)gpt|openai|\bo[1-4](-|$)/.test(value)) return "openai";
	if (/claude|anthropic|sonnet|opus|haiku/.test(value)) return "claude";
	if (/gemini|gemma|google/.test(value)) return "gemini";
	if (/grok|xai/.test(value)) return "grok";
	return "generic";
}

/** Map an automation runner id to a brand icon kind used by the board. */
export function runnerIconKind(runner = "") {
	switch (String(runner).trim().toLowerCase()) {
		case "claude":
			return "claude-code";
		case "gemini":
			return "gemini";
		case "codex":
			return "codex";
		case "cursor":
			return "cursor";
		case "opencode":
			return "opencode";
		case "grok":
			return "grok";
		default:
			return "generic";
	}
}
