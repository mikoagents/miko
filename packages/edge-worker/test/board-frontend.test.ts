import { describe, expect, it } from "vitest";
import {
	canLinkLinearIssue,
	connectionText,
	filterTasks,
	isStale,
	STATUS_NAMES,
} from "../board/tasks-model.mjs";

describe("board tasks helpers", () => {
	it("filters tasks by issue, title, or repository", () => {
		const tasks = [
			{
				id: "1",
				issue: "TEST-1",
				title: "Example",
				repositories: ["miko/core"],
			},
			{
				id: "2",
				issue: "TEST-2",
				title: "Other",
				repositories: ["miko/edge"],
			},
		];
		expect(filterTasks(tasks, "TEST-1")).toHaveLength(1);
		expect(filterTasks(tasks, "edge")).toEqual([tasks[1]]);
		expect(filterTasks(tasks, "")).toHaveLength(2);
		expect(filterTasks(tasks, "missing")).toHaveLength(0);
	});

	it("detects stale snapshots", () => {
		expect(isStale(null)).toBe(true);
		expect(
			isStale({ collectedAt: new Date().toISOString(), stale: false }),
		).toBe(false);
		expect(
			isStale({
				collectedAt: new Date(Date.now() - 20_000).toISOString(),
				stale: false,
			}),
		).toBe(true);
		expect(
			isStale({ collectedAt: new Date().toISOString(), stale: true }),
		).toBe(true);
	});

	it("summarizes connection status", () => {
		const fresh = {
			collectedAt: new Date().toISOString(),
			service: { online: true, status: "idle" },
		};
		expect(
			connectionText({ connected: true, paused: false, latest: fresh }),
		).toBe("Miko idle");
		expect(
			connectionText({
				connected: true,
				paused: false,
				latest: {
					...fresh,
					service: { online: true, status: "busy" },
				},
			}),
		).toBe("Miko busy");
		expect(
			connectionText({ connected: true, paused: true, latest: fresh }),
		).toBe("Display paused");
		expect(
			connectionText({ connected: false, paused: false, latest: fresh }),
		).toBe("Waiting for updates");
	});

	it("validates Linear issue link targets", () => {
		expect(canLinkLinearIssue("ABC-1", "workspace")).toBe(true);
		expect(canLinkLinearIssue("bad", "workspace")).toBe(false);
		expect(canLinkLinearIssue("ABC-1", "")).toBe(false);
		expect(STATUS_NAMES.completed).toBe("Turn completed");
	});
});
