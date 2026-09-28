import { z } from "zod";
import type { RunUpdate } from "./types.js";

export const AUTOMATION_COMPLETION_INSTRUCTIONS = `This scheduled development run must include implementation, verification, and a pull request when changes are needed. Do not treat an intermediate step as task completion.
At the end of your final response, include a hidden completion record:
<!-- miko-automation-result {"outcome":"succeeded","reason":"Completed and verified","prUrls":["https://github.com/owner/repo/pull/123"]} -->
Use outcome "no_change" with a specific reason and an empty prUrls array when no changes are necessary; "awaiting_input" when clarification is required; or "failed" when blocked or unsuccessful. Only report "succeeded" after verification and PR creation. Never invent a PR URL.`;

export const AUTOMATION_OPS_COMPLETION_INSTRUCTIONS = `This scheduled operations run has no code repository and must not open a pull request.
At the end of your final response, include a hidden completion record:
<!-- miko-automation-result {"outcome":"succeeded","reason":"Completed ops work","prUrls":[]} -->
Use outcome "succeeded" with an empty prUrls array when the ops task finished (including when mutations were applied); "no_change" when nothing needed to be done; "awaiting_input" when clarification is required; or "failed" when blocked or unsuccessful. Never invent a PR URL.`;

const schema = z.object({
	outcome: z.enum(["succeeded", "no_change", "awaiting_input", "failed"]),
	reason: z.string().trim().min(1).max(10000),
	prUrls: z
		.array(
			z
				.string()
				.url()
				.refine((url) =>
					/^https:\/\/[^\s/]+\/[^\s]*\/(?:pull|merge_requests)\/\d+\/?$/.test(
						url,
					),
				),
		)
		.max(20),
});

function parseCompletion(body: string, allowSucceededWithoutPr: boolean): RunUpdate {
	const match = /<!--\s*miko-automation-result\s+(\{[\s\S]*?\})\s*-->/.exec(
		body,
	);
	try {
		const result = schema.parse(JSON.parse(match?.[1] ?? ""));
		if (
			result.outcome === "succeeded" &&
			result.prUrls.length === 0 &&
			!allowSucceededWithoutPr
		)
			throw new Error("Missing PR");
		return {
			status: result.outcome === "no_change" ? "succeeded" : result.outcome,
			message: body.replace(match![0], "").trim() || result.reason,
			prUrls: result.prUrls,
		};
	} catch {
		return {
			status: "uncertain",
			message: `The agent ended without a valid final development outcome. Review its activity before clearing this run.\n\n${body}`,
		};
	}
}

export function automationCompletion(body: string): RunUpdate {
	return parseCompletion(body, false);
}

/** Ops / no-repository automations may succeed without a PR URL. */
export function automationOpsCompletion(body: string): RunUpdate {
	return parseCompletion(body, true);
}
