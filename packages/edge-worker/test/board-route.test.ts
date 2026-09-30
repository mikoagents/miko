import { describe, expect, it, vi } from "vitest";
import {
	boardPageFromHash,
	boardPageHref,
	boardPageTitle,
	isBoardPage,
	redirectLegacyBoardHash,
} from "../board/board-route.mjs";

describe("board-route", () => {
	it("maps hashes to pages including schedules aliases", () => {
		expect(boardPageFromHash("#/tasks")).toBe("tasks");
		expect(boardPageFromHash("#/tasks/")).toBe("tasks");
		expect(boardPageFromHash("")).toBe("tasks");
		expect(boardPageFromHash("#/schedules")).toBe("schedules");
		expect(boardPageFromHash("#/automations")).toBe("schedules");
		expect(boardPageFromHash("#/status")).toBe("status");
		expect(boardPageFromHash("#/skills")).toBe("skills");
	});

	it("emits canonical hash hrefs with schedules replacing automations", () => {
		expect(boardPageHref("tasks")).toBe("#/tasks");
		expect(boardPageHref("schedules")).toBe("#/schedules");
		expect(boardPageHref("automations")).toBe("#/schedules");
		expect(boardPageHref("status")).toBe("#/status");
		expect(boardPageHref("skills")).toBe("#/skills");
	});

	it("titles pages for the document shell", () => {
		expect(boardPageTitle("tasks")).toBe("Miko · Tasks & Logs");
		expect(boardPageTitle("schedules")).toBe("Miko · Schedules");
		expect(boardPageTitle("automations")).toBe("Miko · Schedules");
		expect(boardPageTitle("status")).toBe("Miko · Status");
		expect(boardPageTitle("skills")).toBe("Miko · Skills");
	});

	it("recognizes known page ids", () => {
		expect(isBoardPage("tasks")).toBe(true);
		expect(isBoardPage("schedules")).toBe(true);
		expect(isBoardPage("automations")).toBe(true);
		expect(isBoardPage("nope")).toBe(false);
	});

	it("rewrites legacy #/automations without looping", () => {
		const original = globalThis.window;
		const location = {
			hash: "#/automations",
			pathname: "/board/",
			search: "?token=abc",
		};
		const replaceState = vi.fn();
		// @ts-expect-error test stub
		globalThis.window = {
			location,
			history: { replaceState },
		};
		try {
			redirectLegacyBoardHash();
			expect(replaceState).toHaveBeenCalledWith(
				null,
				"",
				"/board/?token=abc#/schedules",
			);
			location.hash = "#/schedules";
			replaceState.mockClear();
			redirectLegacyBoardHash();
			expect(replaceState).not.toHaveBeenCalled();
		} finally {
			globalThis.window = original;
		}
	});
});
