import { describe, expect, it } from "vitest";
import {
	formFromDefinition,
	inputFromForm,
	scheduleFromForm,
} from "../board/automation-model.mjs";

const options = {
	repositories: [{ id: "repo", workspaceId: "ws" }],
	workspaces: [{ id: "ws" }],
};
describe("automation form serialization", () => {
	it("can clear legacy runner and model selections back to defaults", () => {
		const form = formFromDefinition(
			{
				name: "Legacy task",
				instructions: "[agent=cursor]\n[model=gemini-3.8-flash]\n\nDo work",
				target: { kind: "direct_repository" },
				schedule: { kind: "daily", time: "09:00" },
			},
			options,
		);
		const saved = inputFromForm({ ...form, runner: "", model: "" });
		expect(saved.instructions).toBe("Do work");
		const reopened = formFromDefinition(saved, options);
		expect(reopened.runner).toBe("");
		expect(reopened.model).toBe("");
	});
	it("preserves existing weekly rules, target and timezone through editing", () => {
		const input = {
			name: "Weekly maintenance",
			instructions: "Check dependencies",
			repositoryId: "repo",
			schedule: { kind: "weekly", days: [1, 5], time: "09:30" },
			timezone: "America/New_York",
			enabled: false,
			target: {
				kind: "linear_issue",
				workspaceId: "ws",
				teamId: "team",
				projectId: "project",
			},
		};
		expect(inputFromForm(formFromDefinition(input, options))).toEqual(input);
	});
	it("preserves the absolute instant of a one-time task in the browser's timezone", () => {
		const definition = {
			target: { kind: "direct_repository" },
			schedule: { kind: "once", at: "2028-10-05T01:30:00.000Z" },
			timezone: "America/New_York",
		};
		const form = formFromDefinition(definition, options);
		expect(scheduleFromForm(form)).toEqual(definition.schedule);
		expect(inputFromForm(form).timezone).toBe(
			Intl.DateTimeFormat().resolvedOptions().timeZone,
		);
	});
	it("rejects an empty weekly selection and an invalid appointment before sending", () => {
		expect(() =>
			scheduleFromForm({ kind: "weekly", days: [], time: "09:00" }),
		).toThrow("weekday");
		expect(() => scheduleFromForm({ kind: "once", at: "" })).toThrow(
			"date and time",
		);
	});
	it("omits inactive Linear fields when switching to direct execution", () => {
		const form = {
			...formFromDefinition(undefined, options),
			teamId: "old-team",
			projectId: "old-project",
		};
		expect(inputFromForm(form).target).toEqual({ kind: "direct_repository" });
		expect(form.workspaceId).toBe("ws");
	});
	it("preserves runner and model through editing", () => {
		const input = {
			name: "Frontier digest",
			instructions: "Collect news",
			repositoryId: "repo",
			schedule: { kind: "daily", time: "09:00" },
			timezone: "Asia/Shanghai",
			enabled: true,
			target: { kind: "direct_repository" },
			runner: "cursor",
			model: "gemini-3.8-flash",
		};
		expect(inputFromForm(formFromDefinition(input, options))).toEqual(input);
	});
	it("reads legacy agent/model tags when schema fields are unset", () => {
		const form = formFromDefinition(
			{
				instructions: "[agent=cursor]\n[model=gemini-3.8-flash]\n\nDo the work",
				target: { kind: "direct_repository" },
				schedule: { kind: "daily", time: "09:00" },
			},
			options,
		);
		expect(form.runner).toBe("cursor");
		expect(form.model).toBe("gemini-3.8-flash");
	});
	it("omits default runner and blank model from the saved input", () => {
		const form = {
			...formFromDefinition(undefined, options),
			runner: "",
			model: "  ",
		};
		const input = inputFromForm(form);
		expect(input).not.toHaveProperty("runner");
		expect(input).not.toHaveProperty("model");
	});
});
