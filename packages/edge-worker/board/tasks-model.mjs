export const STATUS_NAMES = {
	running: "Running",
	completed: "Turn completed",
	error: "Failed",
	stopped: "Stopped",
	interrupted: "Worker exited",
	unknown: "Unconfirmed",
	idle: "Idle",
};

export function clock(value) {
	return value
		? new Date(value).toLocaleTimeString("en", { hour12: false })
		: "—";
}

export function ago(value) {
	if (!value) return "Unknown";
	const sec = Math.max(0, Math.floor((Date.now() - value) / 1000));
	if (sec < 60) return `${sec}s ago`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
	return `${Math.floor(sec / 3600)}h ago`;
}

export function duration(value) {
	const min = Math.max(0, Math.floor((Date.now() - value) / 60000));
	return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function isStale(data) {
	return (
		!data?.collectedAt ||
		data.stale ||
		Date.now() - Date.parse(data.collectedAt) > 16000
	);
}

export function fastLabel(task) {
	return task.fastMode === true ? " · Fast" : "";
}

export function canLinkLinearIssue(identifier, workspaceSlug) {
	return (
		/^[a-z0-9][a-z0-9_-]*$/i.test(workspaceSlug || "") &&
		/^[a-z0-9]+-\d+$/i.test(identifier || "")
	);
}

export function connectionText({ connected, paused, latest }) {
	const stale = !connected || isStale(latest);
	const state = latest?.service;
	if (stale) return "Waiting for updates";
	if (paused) return "Display paused";
	if (!state?.online) return "Miko offline";
	if (state.status === "busy") return "Miko busy";
	return "Miko idle";
}

export function filterTasks(tasks, needle) {
	const q = needle.trim().toLowerCase();
	if (!q) return tasks || [];
	return (tasks || []).filter((t) =>
		[t.issue, t.title, t.repositories?.join(" ")]
			.join(" ")
			.toLowerCase()
			.includes(q),
	);
}
