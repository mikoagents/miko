const PAGES = new Set(["tasks", "automations", "status", "skills"]);

export function boardPageFromHash(hash) {
	const normalized = hash.replace(/\/$/, "");
	if (normalized === "#/schedules" || normalized === "#/automations")
		return "automations";
	if (normalized === "#/status") return "status";
	if (normalized === "#/skills") return "skills";
	return "tasks";
}

export function boardPageHref(page) {
	if (page === "automations") return "#/schedules";
	if (page === "status") return "#/status";
	if (page === "skills") return "#/skills";
	return "#/tasks";
}

/** Rewrite legacy `#/automations` to `#/schedules` without a hashchange loop. */
export function redirectLegacyBoardHash() {
	const normalized = window.location.hash.replace(/\/$/, "");
	if (normalized === "#/automations") {
		window.history.replaceState(
			null,
			"",
			`${window.location.pathname}${window.location.search}#/schedules`,
		);
	}
}

export function isBoardPage(page) {
	return PAGES.has(page);
}
