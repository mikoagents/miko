import { initializeAutomations } from "./automations.jsx";
import { initializeSkills } from "./skills.jsx";
import { initializeStatus } from "./status.jsx";
import "./layout.css";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { createLogViewer } from "./log-viewer.jsx";

const $ = (id) => document.getElementById(id);
const names = {
	running: "Running",
	completed: "Turn completed",
	error: "Failed",
	stopped: "Stopped",
	interrupted: "Worker exited",
	unknown: "Unconfirmed",
	idle: "Idle",
};
let latest = null,
	displayed = null,
	selected = null,
	paused = false,
	connected = false,
	taskKey = "",
	refreshing = false;
const controls = { source: "all", errorsOnly: false, follow: true, wrap: true };
const viewer = createLogViewer($("logs"), {
	onStopFollowing: () => {
		controls.follow = false;
	},
	onControlsChange: (patch) => {
		Object.assign(controls, patch);
		renderLogs();
	},
	onPause: () => {
		paused = !paused;
		if (!paused && latest) render(latest);
		else {
			renderConnection();
			renderLogs();
		}
	},
	onRefresh: refresh,
	onClearTask: () => {
		selected = null;
		renderTasks();
		renderLogs();
	},
});
const history = new Map();
async function loadHistory(task) {
	if (!task?.archived || history.has(task.id)) return;
	try {
		const response = await fetch(
			`/board/api/history/${encodeURIComponent(task.id)}`,
			{ cache: "no-store" },
		);
		if (!response.ok) throw Error();
		history.set(task.id, {
			at: task.lastActivityAt,
			logs: (await response.json()).logs,
		});
		if (selected === task.id) renderLogs();
	} catch {
		$("warnings").textContent =
			"Cannot load archived logs. Select the task to retry.";
	}
}
function element(tag, cls, text) {
	const el = document.createElement(tag);
	if (cls) el.className = cls;
	if (text !== undefined) el.textContent = text;
	return el;
}
function fastLabel(task) {
	return task.fastMode === true ? " · Fast" : "";
}

/** Brand mark paths (LobeHub Github mono path; Linear/GitLab official marks). */
const PLATFORM_ICONS = {
	github: {
		label: "GitHub",
		viewBox: "0 0 24 24",
		paths: [
			"M12 0c6.63 0 12 5.276 12 11.79-.001 5.067-3.29 9.567-8.175 11.187-.6.118-.825-.25-.825-.56 0-.398.015-1.665.015-3.242 0-1.105-.375-1.813-.81-2.181 2.67-.295 5.475-1.297 5.475-5.822 0-1.297-.465-2.344-1.23-3.169.12-.295.54-1.503-.12-3.125 0 0-1.005-.324-3.3 1.209a11.32 11.32 0 00-3-.398c-1.02 0-2.04.133-3 .398-2.295-1.518-3.3-1.209-3.3-1.209-.66 1.622-.24 2.83-.12 3.125-.765.825-1.23 1.887-1.23 3.169 0 4.51 2.79 5.527 5.46 5.822-.345.294-.66.81-.765 1.577-.69.31-2.415.81-3.495-.973-.225-.354-.9-1.223-1.845-1.209-1.005.015-.405.56.015.781.51.28 1.095 1.327 1.23 1.666.24.663 1.02 1.93 4.035 1.385 0 .988.015 1.916.015 2.196 0 .31-.225.664-.825.56C3.303 21.374-.003 16.867 0 11.791 0 5.276 5.37 0 12 0z",
		],
	},
	linear: {
		label: "Linear",
		viewBox: "0 0 24 24",
		paths: [
			"M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z",
		],
	},
	gitlab: {
		label: "GitLab",
		viewBox: "0 0 24 24",
		paths: [
			"m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z",
		],
	},
	slack: {
		label: "Slack",
		viewBox: "0 0 24 24",
		paths: [
			"M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z",
		],
	},
};

function inferTrackerId(identifier, explicit) {
	const known = String(explicit || "").toLowerCase();
	if (PLATFORM_ICONS[known]) return known;
	const id = String(identifier || "").trim();
	if (/^(?:[\w.-]+\/)?[\w.-]+#\d+$/.test(id)) return "github";
	if (/^[\w.-]+(?:\/[\w.-]+)*!\d+$/.test(id)) return "gitlab";
	if (/^[a-z0-9]+-\d+$/i.test(id)) return "linear";
	return undefined;
}

function resolveIssueUrl(task) {
	if (typeof task.issueUrl === "string" && /^https?:\/\//i.test(task.issueUrl))
		return task.issueUrl;
	const identifier = String(task.issue || "").trim();
	const tracker = inferTrackerId(identifier, task.trackerId);
	if (tracker === "linear") {
		const slug = task.linearWorkspaceSlug;
		if (
			/^[a-z0-9][a-z0-9_-]*$/i.test(slug || "") &&
			/^[a-z0-9]+-\d+$/i.test(identifier)
		) {
			return `https://linear.app/${encodeURIComponent(slug)}/issue/${encodeURIComponent(identifier)}/`;
		}
	}
	return undefined;
}

function svgIcon(spec, className) {
	const namespace = "http://www.w3.org/2000/svg";
	const icon = document.createElementNS(namespace, "svg");
	icon.setAttribute("viewBox", spec.viewBox);
	icon.setAttribute("fill", "currentColor");
	icon.setAttribute("aria-hidden", "true");
	icon.setAttribute("focusable", "false");
	if (className) icon.setAttribute("class", className);
	for (const d of spec.paths) {
		const path = document.createElementNS(namespace, "path");
		path.setAttribute("d", d);
		icon.append(path);
	}
	return icon;
}

function externalLinkIcon() {
	const namespace = "http://www.w3.org/2000/svg";
	const icon = document.createElementNS(namespace, "svg");
	icon.setAttribute("viewBox", "0 0 24 24");
	icon.setAttribute("fill", "none");
	icon.setAttribute("aria-hidden", "true");
	icon.setAttribute("focusable", "false");
	for (const [tag, attributes] of ArrowUpRight01Icon) {
		const shape = document.createElementNS(namespace, tag);
		for (const [name, value] of Object.entries(attributes)) {
			if (name !== "key")
				shape.setAttribute(
					name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
					String(value),
				);
		}
		icon.append(shape);
	}
	return icon;
}

function platformBadge(tracker, platform) {
	const badge = element("span", `task-platform-icon ${tracker}`);
	badge.title = platform.label;
	badge.append(svgIcon(platform, "task-platform-svg"));
	return badge;
}

function appendIssueIdentity(identifierEl, task) {
	const label = task.issue || "Untitled task";
	const tracker = inferTrackerId(task.issue, task.trackerId);
	const platform = tracker ? PLATFORM_ICONS[tracker] : undefined;
	const url = resolveIssueUrl(task);
	if (url) {
		const link = element("a", "task-issue-link");
		link.href = url;
		link.target = "_blank";
		link.rel = "noopener noreferrer";
		const platformName = platform?.label || "issue tracker";
		link.title = `Open ${label} in ${platformName}`;
		link.setAttribute("aria-label", `${link.title} (new tab)`);
		if (platform && tracker) link.append(platformBadge(tracker, platform));
		link.append(element("span", "issue", label), externalLinkIcon());
		identifierEl.append(link);
		return;
	}
	if (platform && tracker) identifierEl.append(platformBadge(tracker, platform));
	identifierEl.append(element("span", "issue", label));
}
function clock(value) {
	return value
		? new Date(value).toLocaleTimeString("en", { hour12: false })
		: "—";
}
function ago(value) {
	if (!value) return "Unknown";
	const sec = Math.max(0, Math.floor((Date.now() - value) / 1000));
	if (sec < 60) return `${sec}s ago`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
	return `${Math.floor(sec / 3600)}h ago`;
}
function duration(value) {
	const min = Math.max(0, Math.floor((Date.now() - value) / 60000));
	return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}
function isStale(data) {
	return (
		!data?.collectedAt ||
		data.stale ||
		Date.now() - Date.parse(data.collectedAt) > 16000
	);
}
function renderConnection() {
	const stale = !connected || isStale(latest),
		state = latest?.service;
	const text = stale
		? "Waiting for updates"
		: paused
			? "Display paused"
			: !state?.online
				? "Miko offline"
				: state.status === "busy"
					? "Miko busy"
					: "Miko idle";
	$("connection").textContent = text;
	$("connection").title =
		text +
		" · " +
		(stale ? "Waiting for fresh data" : "Live connection") +
		" · Last collected " +
		clock(latest?.collectedAt);
}
function render(data) {
	displayed = data;
	for (const [id, cached] of history) {
		const task = data.tasks?.find((task) => task.id === id);
		if (!task?.archived || task.lastActivityAt !== cached.at)
			history.delete(id);
	}
	renderConnection();
	$("warnings").textContent = (data.warnings || []).join(" ");
	renderTasks();
	renderLogs();
	loadHistory(data.tasks?.find((task) => task.id === selected));
}
function renderTasks() {
	const needle = $("task-search").value.trim().toLowerCase();
	const tasks = (displayed?.tasks || []).filter(
		(t) =>
			!needle ||
			[t.issue, t.title, t.repositories?.join(" ")]
				.join(" ")
				.toLowerCase()
				.includes(needle),
	);
	const stale = isStale(displayed);
	const key = JSON.stringify([
		tasks.map((t) => [
			t.id,
			t.issue,
			t.linearWorkspaceSlug,
			t.trackerId,
			t.issueUrl,
			t.title,
			t.model,
			t.reasoningEffort,
			t.fastMode,
			t.status,
			t.reason,
			t.quiet,
			t.repositories,
			t.lastActivityAt,
			t.status === "running" ? duration(t.turnStartedAt) : null,
		]),
		selected,
		needle,
		stale,
	]);
	if (key === taskKey) return;
	taskKey = key;
	$("tasks").replaceChildren();
	if (!tasks.length) {
		$("tasks").append(
			element("div", "empty", needle ? "No matching tasks" : "No tasks yet"),
		);
		return;
	}
	for (const t of tasks) {
		const card = element("div", `task${selected === t.id ? " selected" : ""}`);
		const b = element("button", "task-select");
		b.type = "button";
		b.setAttribute("aria-pressed", String(selected === t.id));
		b.setAttribute(
			"aria-label",
			`View logs for ${t.issue || "task"}: ${t.title || "Loading task title"}`,
		);
		b.title =
			t.reason +
			(t.quiet ? " · No activity for over 2 minutes" : "") +
			`\nModel: ${t.model || "Unknown"}` +
			`\nReasoning effort: ${t.reasoningEffort || "Unknown"}` +
			(t.fastMode === true ? "\nFast" : "") +
			"\nSession " +
			t.id;
		const top = element("div", "task-top");
		const identifier = element("div", "task-identifier");
		appendIssueIdentity(identifier, t);
		top.append(
			identifier,
			element(
				"span",
				"task-time",
				t.status === "running"
					? duration(t.turnStartedAt)
					: clock(t.lastActivityAt),
			),
		);
		const meta = element("div", "task-meta");
		const context = element("div", "task-context");
		context.append(
			element(
				"span",
				"task-repository",
				(t.repositories?.join(", ") || "Repository unconfirmed") +
					(t.archived ? " · Archived" : ""),
			),
			element(
				"span",
				"task-model",
				`${t.model || "Model unknown"} · ${t.reasoningEffort || "Effort unknown"}${fastLabel(t)}`,
			),
		);
		meta.append(
			context,
			element(
				"span",
				`pill ${stale && t.status === "running" ? "unknown" : t.status}`,
				stale && t.status === "running"
					? "Previously running"
					: names[t.status] || t.status,
			),
		);
		card.append(
			b,
			top,
			element("div", "task-title", t.title || "Loading task title"),
			meta,
		);
		b.addEventListener("click", () => {
			selected = selected === t.id ? null : t.id;
			renderTasks();
			renderLogs();
			loadHistory(t);
		});
		$("tasks").append(card);
	}
}
function renderLogs() {
	const task = displayed?.tasks?.find((t) => t.id === selected);
	const taskDetail = task
		? `${task.issue || "Task"} · ` +
			(task.model || "Unknown model") +
			" · " +
			(task.reasoningEffort || "Effort unknown") +
			fastLabel(task) +
			" · " +
			(names[task.status] || task.status) +
			" · Last activity " +
			ago(task.lastActivityAt) +
			(task.archived ? " · Archived · Up to 100 recent entries" : "") +
			(task.quiet ? " · No activity for over 2 minutes" : "")
		: "";
	const { source } = controls;
	const logs = (
		task?.archived ? history.get(task.id)?.logs || [] : displayed?.logs || []
	).filter(
		(l) =>
			(!task ||
				(l.sessionId ? l.sessionId === task.id : l.issue === task.issue)) &&
			(source === "all" || l.source === source),
	);
	viewer.update({
		logs,
		...controls,
		paused,
		refreshing,
		taskDetail,
		showIssue: !task,
		scope: [selected, source, controls.errorsOnly].join("|"),
	});
}
$("task-search").addEventListener("input", renderTasks);
async function refresh() {
	if (refreshing) return;
	refreshing = true;
	renderLogs();
	try {
		const r = await fetch("/board/api/snapshot", { cache: "no-store" });
		if (!r.ok) throw Error();
		latest = await r.json();
		paused = false;
		render(latest);
	} catch {
		$("warnings").textContent =
			"Cannot reach the monitor. Reconnecting automatically.";
	} finally {
		refreshing = false;
		renderLogs();
	}
}
const stream = new EventSource("/board/events");
stream.onopen = () => {
	connected = true;
	renderConnection();
};
stream.onerror = () => {
	connected = false;
	renderConnection();
};
stream.addEventListener("unavailable", () => {
	connected = false;
	renderConnection();
});
stream.onmessage = (event) => {
	try {
		latest = JSON.parse(event.data);
		connected = true;
		if (!paused) render(latest);
	} catch {
		$("warnings").textContent =
			"Incomplete update received. Waiting for the next refresh.";
	}
};
setInterval(() => {
	renderConnection();
	if (!paused && displayed && isStale(displayed)) renderTasks();
}, 3000);

initializeAutomations((sessionId) => {
	selected = sessionId;
	renderTasks();
	renderLogs();
	void loadHistory(displayed?.tasks?.find((task) => task.id === sessionId));
});
initializeStatus();
initializeSkills();
