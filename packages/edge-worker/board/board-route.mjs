const PAGES = new Set(["tasks", "automations", "status", "skills"]);

export function boardPageFromHash(hash) {
	const normalized = hash.replace(/\/$/, "");
	if (normalized === "#/automations") return "automations";
	if (normalized === "#/status") return "status";
	if (normalized === "#/skills") return "skills";
	return "tasks";
}

export function boardPageHref(page) {
	if (page === "automations") return "#/automations";
	if (page === "status") return "#/status";
	if (page === "skills") return "#/skills";
	return "#/tasks";
}

export function isBoardPage(page) {
	return PAGES.has(page);
}
