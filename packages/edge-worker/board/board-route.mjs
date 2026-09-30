const PAGES = new Set([
	"tasks",
	"automations",
	"schedules",
	"status",
	"skills",
]);

/** Map a location hash (e.g. `#/schedules`) to a board page id. */
export function boardPageFromHash(hash) {
	const normalized = String(hash || "").replace(/\/$/, "");
	if (normalized === "#/schedules" || normalized === "#/automations")
		return "schedules";
	if (normalized === "#/status") return "status";
	if (normalized === "#/skills") return "skills";
	return "tasks";
}

/** Canonical hash href for a board page id. */
export function boardPageHref(page) {
	if (page === "automations" || page === "schedules") return "#/schedules";
	if (page === "status") return "#/status";
	if (page === "skills") return "#/skills";
	return "#/tasks";
}

/**
 * Rewrite legacy `#/automations` to `#/schedules` without a hashchange loop.
 * Prefer TanStack Router's redirect route in the SPA; this remains for tests
 * and any non-router callers.
 */
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

export function boardPageTitle(page) {
	if (page === "schedules" || page === "automations") return "Miko · Schedules";
	if (page === "status") return "Miko · Status";
	if (page === "skills") return "Miko · Skills";
	return "Miko · Tasks & Logs";
}
