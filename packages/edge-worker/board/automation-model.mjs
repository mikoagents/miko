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
	const repo = definition?.repositoryId
		? options.repositories.find((r) => r.id === definition.repositoryId)
		: options.repositories[0];
	const at =
		definition?.schedule.kind === "once"
			? new Date(definition.schedule.at)
			: new Date(Date.now() + 3600000);
	const fromTags = parseRunnerModelFromInstructions(definition?.instructions);
	return formWithRepository(
		{
			name: definition?.name || "",
			instructions: (definition?.instructions || "")
				.replace(/\[(?:agent|model)\s*=[^\]]*\]\s*/gi, "")
				.trim(),
			repositoryId: repo?.id || "",
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
		repo,
	);
}
export function formWithRepository(form, repository) {
	const workspaceId = repository?.workspaceId || "";
	const sameWorkspace = !!workspaceId && workspaceId === form.workspaceId;
	return {
		...form,
		repositoryId: repository?.id || "",
		workspaceId,
		teamId: sameWorkspace ? form.teamId : "",
		projectId: sameWorkspace ? form.projectId : "",
	};
}
export function formWithTeam(form, teamId) {
	return {
		...form,
		teamId,
		projectId: teamId === form.teamId ? form.projectId : "",
	};
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
	const input = {
		name: form.name.trim(),
		instructions: form.instructions.trim(),
		repositoryId: form.repositoryId,
		timezone:
			form.kind === "once"
				? Intl.DateTimeFormat().resolvedOptions().timeZone
				: form.timezone,
		enabled: form.enabled,
		schedule: scheduleFromForm(form),
		target:
			form.target === "direct_repository"
				? { kind: "direct_repository" }
				: {
						kind: "linear_issue",
						workspaceId: form.workspaceId,
						teamId: form.teamId,
						...(form.projectId ? { projectId: form.projectId } : {}),
					},
	};
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
