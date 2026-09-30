import { describe, expect, it } from "vitest";
import {
	inferBoardTrackerId,
	resolveBoardIssueUrl,
} from "../src/boardIssueLink.js";

describe("boardIssueLink", () => {
	it("infers tracker from identifier shape", () => {
		expect(inferBoardTrackerId("BUILDER-273")).toBe("linear");
		expect(inferBoardTrackerId("Viora-Mono#919")).toBe("github");
		expect(inferBoardTrackerId("VioraOS/Viora-Mono#919")).toBe("github");
		expect(inferBoardTrackerId("group/project!42")).toBe("gitlab");
		expect(inferBoardTrackerId("chat", "slack")).toBe("slack");
	});

	it("builds Linear URLs from workspace slug", () => {
		expect(
			resolveBoardIssueUrl({
				identifier: "BUILDER-273",
				trackerId: "linear",
				linearWorkspaceSlug: "viora",
			}),
		).toBe("https://linear.app/viora/issue/BUILDER-273/");
	});

	it("builds GitHub issue URLs from Repo#N and configured githubUrl", () => {
		expect(
			resolveBoardIssueUrl({
				identifier: "Viora-Mono#919",
				trackerId: "github",
				githubUrl: "https://github.com/VioraOS/Viora-Mono.git",
			}),
		).toBe("https://github.com/VioraOS/Viora-Mono/issues/919");
	});

	it("builds GitHub URLs from owner/repo#N without config", () => {
		expect(
			resolveBoardIssueUrl({
				identifier: "mikoagents/miko#36",
			}),
		).toBe("https://github.com/mikoagents/miko/issues/36");
	});

	it("builds GitLab MR URLs", () => {
		expect(
			resolveBoardIssueUrl({
				identifier: "group/project!7",
				trackerId: "gitlab",
				gitlabUrl: "https://gitlab.com/group/project",
			}),
		).toBe("https://gitlab.com/group/project/-/merge_requests/7");
	});

	it("returns undefined when a platform URL cannot be resolved", () => {
		expect(
			resolveBoardIssueUrl({
				identifier: "Viora-Mono#919",
				trackerId: "github",
			}),
		).toBeUndefined();
		expect(
			resolveBoardIssueUrl({
				identifier: "BUILDER-273",
				trackerId: "linear",
			}),
		).toBeUndefined();
	});
});
