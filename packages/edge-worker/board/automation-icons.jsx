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
	const boxStyle = { width: size, height: size };
	if (!Icon) {
		return (
			<span
				className={`automation-brand-icon ${className || ""}`.trim()}
				style={boxStyle}
				aria-hidden
			>
				<Brain size={size} strokeWidth={1.75} />
			</span>
		);
	}
	const Avatar = Icon.Avatar || Icon.Color || Icon;
	return (
		<span
			className={`automation-brand-icon ${className || ""}`.trim()}
			style={boxStyle}
			aria-hidden
		>
			<Avatar size={size} />
		</span>
	);
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
