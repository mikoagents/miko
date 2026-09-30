import {
	Claude,
	ClaudeCode,
	Codex,
	Cursor,
	Gemini,
	Grok,
	OpenAI,
	OpenCode,
} from "@lobehub/icons";
import { Brain } from "lucide-react";
import { modelIconKind, runnerIconKind } from "./automation-model.mjs";

const ICONS = {
	openai: OpenAI,
	claude: Claude,
	"claude-code": ClaudeCode,
	gemini: Gemini,
	grok: Grok,
	cursor: Cursor,
	codex: Codex,
	opencode: OpenCode,
};

function BrandIcon({ kind, size = 14, className }) {
	const Icon = ICONS[kind];
	if (!Icon) {
		return (
			<Brain size={size} strokeWidth={1.75} className={className} aria-hidden />
		);
	}
	const Avatar = Icon.Avatar || Icon.Color || Icon;
	return <Avatar size={size} className={className} aria-hidden />;
}

export function AutomationModelIcon({ model, size = 14, className }) {
	return (
		<BrandIcon kind={modelIconKind(model)} size={size} className={className} />
	);
}

export function AutomationRunnerIcon({ runner, size = 14, className }) {
	return (
		<BrandIcon
			kind={runnerIconKind(runner)}
			size={size}
			className={className}
		/>
	);
}

export { modelIconKind, runnerIconKind };
