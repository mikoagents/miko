import { useNavigate } from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";
import {
	Archive,
	ArrowDownLeft,
	Check,
	ChevronRight,
	Clock3,
	ExternalLink,
	Pause,
	Play,
	Plus,
	ShieldCheck,
	X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
	automationApi as api,
	formatDate,
	formFromDefinition,
	formWithRepository,
	formWithTarget,
	formWithTeam,
	inputFromForm,
	modelChoices,
	RUNNER_LABELS,
	runLabels,
	scheduleFromForm,
	scheduleLabel,
	statusColors,
} from "./automation-model.mjs";
import { useBoardSession } from "./board-session.jsx";
import { Badge } from "./fluid/components/ui/badge";
import { Button } from "./fluid/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./fluid/components/ui/dialog";
import { InputField, InputGroup } from "./fluid/components/ui/input-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "./fluid/components/ui/select";
import { Switch } from "./fluid/components/ui/switch";
import { TabItem, Tabs, TabsList } from "./fluid/components/ui/tabs";
import { ShapeProvider } from "./fluid/lib/shape-context";
import "./fluid/theme.css";
import "./automations.css";

const emptyOptions = {
	repositories: [],
	workspaces: [],
	runners: [],
	defaultModels: {},
	modelSuggestions: {},
};
const weekdayNames = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

function StatusBadge({ status }) {
	return (
		<Badge variant="dot" color={statusColors[status] || "gray"} size="compact">
			{runLabels[status] || status.charAt(0).toUpperCase() + status.slice(1)}
		</Badge>
	);
}
function FormInput({ label, id: providedId, onChange, ...props }) {
	const generatedId = useId();
	const id = providedId || generatedId;
	return (
		<div className="automation-field">
			<label htmlFor={id}>{label}</label>
			<input
				className="automation-text-input"
				id={id}
				onChange={(event) => onChange(event.target.value)}
				{...props}
			/>
		</div>
	);
}
function FieldSelect({
	label,
	value,
	onChange,
	items,
	placeholder = "Choose an option",
	disabled = false,
}) {
	const id = useId();
	return (
		<div className="automation-field">
			<label id={`${id}-label`} htmlFor={id}>
				{label}
			</label>
			<Select value={value} onValueChange={onChange} disabled={disabled}>
				<SelectTrigger
					id={id}
					aria-labelledby={`${id}-label`}
					placeholder={placeholder}
					className="automation-select"
				/>
				<SelectContent className="fluid-scope">
					{items.map(([key, text], index) => (
						<SelectItem key={key} value={key} index={index}>
							{text}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function AutomationEditor({
	definition,
	kind,
	options,
	onClose,
	onSaved,
	children,
}) {
	const [panel, setPanel] = useState("configuration");
	const [form, setForm] = useState(() =>
		formFromDefinition(definition, options, kind),
	);
	const savedEnabled = definition?.enabled;
	useEffect(() => {
		if (savedEnabled !== undefined)
			setForm((current) => ({ ...current, enabled: savedEnabled }));
	}, [savedEnabled]);
	const [teams, setTeams] = useState([]);
	const [teamsLoading, setTeamsLoading] = useState(false);
	const [preview, setPreview] = useState({
		times: [],
		loading: true,
		error: "",
	});
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const instructionsId = useId();
	const set = (key, value) =>
		setForm((current) => ({ ...current, [key]: value }));
	const scheduleKey = JSON.stringify({
		kind: form.kind,
		at: form.at,
		time: form.time,
		days: form.days,
		expression: form.expression,
		timezone: form.timezone,
	});
	useEffect(() => {
		const controller = new AbortController();
		setPreview({ times: [], loading: true, error: "" });
		const timer = setTimeout(async () => {
			try {
				const fields = JSON.parse(scheduleKey);
				const result = await api(
					"/preview",
					"POST",
					{ schedule: scheduleFromForm(fields), timezone: fields.timezone },
					controller.signal,
				);
				if (!controller.signal.aborted)
					setPreview({
						...result,
						loading: false,
						error: result.times.length ? "" : "Choose a future execution time.",
					});
			} catch (e) {
				if (!controller.signal.aborted)
					setPreview({ times: [], loading: false, error: e.message });
			}
		}, 250);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [scheduleKey]);
	useEffect(() => {
		if (form.target !== "linear_issue" || !form.workspaceId) {
			setTeams([]);
			setTeamsLoading(false);
			return;
		}
		const controller = new AbortController();
		setTeams([]);
		setTeamsLoading(true);
		api(
			`/linear-options?workspaceId=${encodeURIComponent(form.workspaceId)}`,
			"GET",
			undefined,
			controller.signal,
		)
			.then((data) => {
				if (controller.signal.aborted) return;
				setTeams(data);
				setForm((current) =>
					formWithTeam(
						current,
						data.some((team) => team.id === current.teamId)
							? current.teamId
							: data[0]?.id || "",
					),
				);
			})
			.catch((e) => {
				if (!controller.signal.aborted) setError(e.message);
			})
			.finally(() => {
				if (!controller.signal.aborted) setTeamsLoading(false);
			});
		return () => controller.abort();
	}, [form.target, form.workspaceId]);
	async function submit(event) {
		event.preventDefault();
		setError("");
		setSaving(true);
		try {
			const input = inputFromForm(form);
			if (input.target.kind === "linear_issue") {
				if (!input.target.workspaceId)
					throw new Error(
						"Choose a repository that is connected to a Linear workspace.",
					);
				if (!input.target.teamId) throw new Error("Choose a Linear team.");
			}
			const saved = definition
				? await api(`/${definition.id}`, "PATCH", {
						revision: definition.revision,
						input,
					})
				: await api("", "POST", input);
			await onSaved(saved);
		} catch (e) {
			setError(e.message);
		} finally {
			setSaving(false);
		}
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !saving) onClose();
			}}
		>
			<DialogContent
				size="xl"
				className="fluid-scope automation-editor"
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					requestAnimationFrame(() =>
						document.getElementById("automation-name")?.focus(),
					);
				}}
			>
				<DialogHeader className="automation-editor-header">
					<DialogTitle>
						{definition?.archived
							? "Archived automation"
							: definition
								? "Edit automation"
								: "New automation"}
					</DialogTitle>
					<DialogDescription>
						{definition
							? definition.name
							: "Define what to do and when to run it."}
					</DialogDescription>
					{definition && <StatusBadge status={definition.scheduleState} />}
				</DialogHeader>
				{definition && (
					<div className="automation-editor-tabs">
						<Tabs value={panel} onValueChange={setPanel}>
							<TabsList aria-label="Automation details">
								<TabItem value="configuration" label="Configuration" />
								<TabItem value="history" label="Run history" />
							</TabsList>
						</Tabs>
					</div>
				)}
				<form onSubmit={submit}>
					<div className="automation-editor-body">
						<fieldset
							className="automation-editor-fields"
							disabled={definition?.archived}
							hidden={panel !== "configuration"}
						>
							<section className="automation-form-section automation-task-section">
								<h3 className="automation-section-label">Task</h3>
								<div className="automation-input-group">
									<FormInput
										id="automation-name"
										label="Name"
										placeholder="e.g. Review dependencies every Monday"
										value={form.name}
										onChange={(value) => set("name", value)}
										required
										maxLength={200}
									/>
								</div>
								<div className="automation-field automation-instruction-field">
									<label htmlFor={instructionsId}>Instructions</label>
									<textarea
										id={instructionsId}
										placeholder="Describe the work, what to verify, and what a good result looks like…"
										value={form.instructions}
										onChange={(event) =>
											set("instructions", event.target.value)
										}
										required
										maxLength={50000}
										rows={6}
									/>
								</div>
							</section>
							<div className="automation-settings-column">
								<section className="automation-form-section">
									<h3 className="automation-section-label">Execution</h3>
									<div className="automation-form-grid">
										{form.target !== "direct_ops" && (
											<FieldSelect
												label="Repository"
												value={form.repositoryId}
												onChange={(value) =>
													setForm((current) =>
														formWithRepository(
															current,
															options.repositories.find((r) => r.id === value),
														),
													)
												}
												items={options.repositories.map((r) => [r.id, r.name])}
												placeholder="Choose a repository"
											/>
										)}
										<FieldSelect
											label="Mode"
											value={form.target}
											onChange={(value) =>
												setForm((current) =>
													formWithTarget(current, value, options),
												)
											}
											items={[
												["direct_repository", "Run directly"],
												["direct_ops", "Ops (no repository)"],
												["linear_issue", "Create Linear issue"],
											]}
										/>
									</div>
									<div className="automation-form-grid">
										<FieldSelect
											label="Agent"
											value={form.runner || "default"}
											onChange={(value) =>
												setForm((current) => ({
													...current,
													runner: value === "default" ? "" : value,
													// Keep model when switching agents; Cursor accepts cross-provider IDs.
												}))
											}
											items={[
												[
													"default",
													options.defaultRunner
														? `Default (${RUNNER_LABELS[options.defaultRunner] || options.defaultRunner})`
														: "Default",
												],
												...(options.runners || Object.keys(RUNNER_LABELS)).map(
													(runner) => [runner, RUNNER_LABELS[runner] || runner],
												),
											]}
										/>
										<div className="automation-field">
											<label htmlFor="automation-model">Model</label>
											<input
												className="automation-text-input"
												id="automation-model"
												list="automation-model-suggestions"
												placeholder={
													(form.runner &&
														options.defaultModels?.[form.runner]) ||
													(options.defaultRunner &&
														options.defaultModels?.[options.defaultRunner]) ||
													"Default for agent"
												}
												value={form.model}
												onChange={(event) => set("model", event.target.value)}
												maxLength={200}
											/>
											<datalist id="automation-model-suggestions">
												{modelChoices(options, form.runner).map((model) => (
													<option key={model} value={model} />
												))}
											</datalist>
										</div>
									</div>
									<p className="automation-field-hint">
										{form.target === "direct_repository"
											? "An isolated worktree. Agent and model override the install defaults for this schedule."
											: form.target === "direct_ops"
												? "Runs in a separate workspace without cloning a repository. Use for Linear operations and other tasks outside a code repository."
												: "Creates an issue in this repository's Linear workspace and delegates it to your connected Miko agent. Agent and model are applied as routing tags."}
									</p>
									{form.target === "linear_issue" && (
										<div className="automation-linear-fields">
											<FieldSelect
												label="Team"
												value={form.teamId}
												onChange={(value) =>
													setForm((current) => formWithTeam(current, value))
												}
												items={teams.map((t) => [t.id, t.name])}
												disabled={teamsLoading || !form.workspaceId}
												placeholder={
													!form.workspaceId
														? "Repository has no Linear workspace"
														: teamsLoading
															? "Loading teams…"
															: "Choose a team"
												}
											/>
										</div>
									)}
								</section>
								<section className="automation-form-section">
									<h3 className="automation-section-label">Schedule</h3>
									<div className="automation-form-grid">
										<FieldSelect
											label="Repeat"
											value={form.kind}
											onChange={(value) =>
												setForm((current) => ({
													...current,
													kind: value,
													timezone:
														value === "once"
															? Intl.DateTimeFormat().resolvedOptions().timeZone
															: current.timezone,
												}))
											}
											items={[
												["once", "Once"],
												["daily", "Every day"],
												["weekly", "Every week"],
												["cron", "Custom cron"],
											]}
										/>
										<div className="automation-input-group">
											{form.kind === "once" ? (
												<FormInput
													label="Date & time"
													type="datetime-local"
													value={form.at}
													onChange={(value) => set("at", value)}
													required
												/>
											) : form.kind === "cron" ? (
												<FormInput
													label="Cron expression"
													placeholder="0 9 * * *"
													value={form.expression}
													onChange={(value) => set("expression", value)}
													required
												/>
											) : (
												<FormInput
													label="Time"
													type="time"
													value={form.time}
													onChange={(value) => set("time", value)}
													required
												/>
											)}
										</div>
									</div>
									{form.kind === "weekly" && (
										<fieldset className="automation-weekdays">
											<legend>Run on</legend>
											<div>
												{[1, 2, 3, 4, 5, 6, 0].map((day) => (
													<Button
														key={day}
														type="button"
														variant={
															form.days.includes(day) ? "secondary" : "ghost"
														}
														active={form.days.includes(day)}
														aria-pressed={form.days.includes(day)}
														aria-label={weekdayNames[day]}
														onClick={() =>
															set(
																"days",
																form.days.includes(day)
																	? form.days.filter((d) => d !== day)
																	: [...form.days, day],
															)
														}
													>
														{weekdayNames[day].slice(0, 2)}
													</Button>
												))}
											</div>
										</fieldset>
									)}
									{form.kind === "cron" && (
										<p className="automation-field-hint">
											Five fields: minute · hour · day · month · weekday.
										</p>
									)}
									<div className="automation-input-group">
										<FormInput
											label="Timezone"
											value={form.timezone}
											onChange={(value) => set("timezone", value)}
											readOnly={form.kind === "once"}
											required
										/>
									</div>
									<div
										className={`automation-preview ${preview.error ? "is-error" : ""}`}
										aria-live="polite"
									>
										<div>
											<strong>
												{preview.loading
													? "Checking schedule…"
													: preview.error
														? "Check your schedule"
														: "Coming up next"}
											</strong>
										</div>
										{preview.error ? (
											<p>{preview.error}</p>
										) : (
											<ol>
												{preview.times.map((time) => (
													<li key={time}>{formatDate(time, form.timezone)}</li>
												))}
											</ol>
										)}
									</div>
								</section>
								<div className="automation-enabled-row">
									<div>
										<strong>Enable schedule</strong>
										<p>Runs while Miko is online. Missed times are skipped.</p>
									</div>
									<Switch
										label="Enable schedule"
										checked={form.enabled}
										onToggle={() => set("enabled", !form.enabled)}
										className="automation-switch-only"
									/>
								</div>
							</div>
						</fieldset>
						<div hidden={panel !== "history"}>{children}</div>
						{error && panel === "configuration" && (
							<div className="automation-error" role="alert">
								{error}
							</div>
						)}
					</div>
					<DialogFooter className="automation-editor-footer">
						<Button
							type="button"
							variant="ghost"
							onClick={onClose}
							disabled={saving}
						>
							{panel === "history" || definition?.archived ? "Close" : "Cancel"}
						</Button>
						{panel === "configuration" && !definition?.archived && (
							<Button
								type="submit"
								leadingIcon={definition ? Check : Plus}
								loading={saving}
								disabled={
									definition?.archived ||
									(form.target !== "direct_ops" && !form.repositoryId) ||
									!preview.times.length ||
									preview.loading ||
									teamsLoading
								}
							>
								{definition ? "Save changes" : "Create automation"}
							</Button>
						)}
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function RunCard({ run, onSession, onAction, busy }) {
	const timezone = run.snapshot.timezone;
	const needsAttention = ["failed", "uncertain", "awaiting_input"].includes(
		run.status,
	);
	return (
		<article className="automation-run">
			<header className="automation-run-heading">
				<time dateTime={new Date(run.scheduledAt).toISOString()}>
					{formatDate(run.scheduledAt, timezone)}
				</time>
				<StatusBadge status={run.status} />
			</header>
			<p className="automation-run-meta">
				{run.trigger === "manual" ? "Manual run" : "Scheduled run"} · {timezone}
			</p>
			{run.message ? (
				<details className="automation-result" open={needsAttention}>
					<summary>
						<span className="automation-result-preview">
							{run.message.split("\n")[0]}
						</span>
						<span className="automation-result-collapse">Hide output</span>
						<ChevronRight size={14} />
					</summary>
					<div className="automation-result-body">
						<p>{run.message}</p>
						{run.startedAt && (
							<p className="automation-run-start">
								Started {formatDate(run.startedAt, timezone)}
							</p>
						)}
					</div>
				</details>
			) : (
				<p className="automation-run-pending">No output yet.</p>
			)}
			<div className="automation-run-links">
				{run.sessionId && (
					<button type="button" onClick={() => onSession(run.sessionId)}>
						View activity <ArrowDownLeft size={12} />
					</button>
				)}
				{run.issueUrl?.startsWith("https://") && (
					<a href={run.issueUrl} target="_blank" rel="noreferrer">
						Linear issue <ExternalLink size={12} />
					</a>
				)}
				{run.prUrls
					.filter((url) => url.startsWith("https://"))
					.map((url, index) => (
						<a key={url} href={url} target="_blank" rel="noreferrer">
							Pull request {run.prUrls.length > 1 ? index + 1 : ""}
							<ExternalLink size={12} />
						</a>
					))}
				{["uncertain", "waiting_session", "awaiting_input"].includes(
					run.status,
				) && (
					<button
						type="button"
						disabled={!!busy}
						onClick={() => onAction("reconcile", run)}
					>
						{busy === run.id ? "Checking…" : "Check execution"}
					</button>
				)}
				{run.status === "uncertain" && (
					<button
						type="button"
						disabled={!!busy}
						onClick={() => onAction("confirm", run)}
					>
						Confirm ended
					</button>
				)}
			</div>
		</article>
	);
}
function AutomationActivity({
	definition,
	runs,
	loading,
	onAction,
	onSession,
	busy,
}) {
	return (
		<section
			className="automation-dialog-activity"
			aria-label="Automation activity"
		>
			<div className="automation-history-toolbar">
				<span>
					{loading
						? "Loading runs…"
						: `${runs.length} ${runs.length === 1 ? "run" : "runs"}`}
				</span>
				{!definition.archived && (
					<div className="automation-detail-actions">
						<Button
							size="compact"
							type="button"
							variant="secondary"
							leadingIcon={Play}
							loading={busy === "run"}
							onClick={() => onAction("run")}
						>
							Run now
						</Button>
						<Button
							size="compact"
							type="button"
							variant="tertiary"
							leadingIcon={definition.enabled ? Pause : Play}
							disabled={!!busy}
							onClick={() => onAction("toggle")}
						>
							{definition.enabled ? "Pause" : "Resume"}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-compact"
							title="Archive automation"
							aria-label="Archive automation"
							onClick={() => onAction("archive")}
						>
							<Archive size={16} />
						</Button>
					</div>
				)}
			</div>
			<div>
				{loading ? (
					<p className="automation-history-empty">Loading runs…</p>
				) : !runs.length ? (
					<div className="automation-history-empty">
						<div className="automation-history-empty-icon">
							<Clock3 size={18} />
						</div>
						<strong>All set. Nothing has run yet.</strong>
						<p>
							Your first result will appear here after a scheduled or manual
							run.
						</p>
					</div>
				) : (
					<div className="automation-timeline">
						{runs.map((run) => (
							<RunCard
								key={run.id}
								run={run}
								onSession={onSession}
								onAction={onAction}
								busy={busy}
							/>
						))}
					</div>
				)}
			</div>
		</section>
	);
}

export function SchedulesPage() {
	const navigate = useNavigate();
	const { selectSession } = useBoardSession();
	const [definitions, setDefinitions] = useState([]);
	const [options, setOptions] = useState(emptyOptions);
	const [loading, setLoading] = useState(true);
	const [selected, setSelected] = useState(null);
	const [query, setQuery] = useState("");
	const [editor, setEditor] = useState(null);
	const [confirmation, setConfirmation] = useState(null);
	const [error, setError] = useState("");
	const [storeError, setStoreError] = useState("");
	const [busy, setBusy] = useState("");
	const [runs, setRuns] = useState([]);
	const [runsLoading, setRunsLoading] = useState(false);
	const [runVersion, setRunVersion] = useState(0);
	const manualRequests = useRef(new Map());
	const definition = definitions.find((d) => d.id === selected);
	const reload = useCallback(async (signal) => {
		const [data, opts] = await Promise.all([
			api("", "GET", undefined, signal),
			api("/options", "GET", undefined, signal),
		]);
		if (signal?.aborted) return;
		setDefinitions(data.definitions);
		setStoreError(data.error || "");
		setOptions(opts);
		setLoading(false);
	}, []);
	useEffect(() => {
		const controller = new AbortController();
		const refresh = () =>
			reload(controller.signal).catch((e) => {
				if (!controller.signal.aborted) {
					setError(e.message);
					setLoading(false);
				}
			});
		void refresh();
		const timer = setInterval(refresh, 10000);
		return () => {
			controller.abort();
			clearInterval(timer);
		};
	}, [reload]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runVersion explicitly refreshes history after a mutation.
	useEffect(() => {
		if (!selected || !editor?.definition) {
			setRuns([]);
			return;
		}
		const controller = new AbortController();
		setRunsLoading(true);
		const refresh = () =>
			api(`/${selected}/runs`, "GET", undefined, controller.signal)
				.then((data) => {
					if (!controller.signal.aborted) {
						setRuns(data);
						setRunsLoading(false);
					}
				})
				.catch((e) => {
					if (!controller.signal.aborted) {
						setError(e.message);
						setRunsLoading(false);
					}
				});
		void refresh();
		const timer = setInterval(refresh, 10000);
		return () => {
			controller.abort();
			clearInterval(timer);
		};
	}, [selected, runVersion, editor?.definition?.id]);
	const matching = definitions.filter(
		(d) =>
			!d.archived &&
			`${d.name} ${d.instructions}`.toLowerCase().includes(query.toLowerCase()),
	);

	async function perform(action, run) {
		if (!definition) return;
		if (action === "archive" || action === "confirm") {
			setConfirmation({ action, run, definition });
			return;
		}
		setBusy(run?.id || action);
		setError("");
		try {
			if (action === "run") {
				const requestId =
					manualRequests.current.get(definition.id) || crypto.randomUUID();
				manualRequests.current.set(definition.id, requestId);
				await api(`/${definition.id}/run`, "POST", { requestId });
				manualRequests.current.delete(definition.id);
			} else if (action === "toggle")
				await api(`/${definition.id}`, "PATCH", {
					revision: definition.revision,
					enabled: !definition.enabled,
				});
			else if (action === "reconcile")
				await api(`/${definition.id}/runs/${run.id}/reconcile`, "POST", {});
			await reload();
			setRunVersion((v) => v + 1);
		} catch (e) {
			setError(e.message);
		} finally {
			setBusy("");
		}
	}
	async function confirm() {
		setBusy("confirm");
		setError("");
		try {
			const { action, definition: d, run } = confirmation;
			if (action === "archive")
				await api(`/${d.id}`, "DELETE", { revision: d.revision });
			else
				await api(`/${d.id}/runs/${run.id}/confirm-ended`, "POST", {
					confirmedEnded: true,
				});
			setConfirmation(null);
			if (action === "archive") {
				setEditor(null);
				setSelected(null);
			}
			await reload();
			setRunVersion((v) => v + 1);
		} catch (e) {
			setError(e.message);
			setConfirmation(null);
		} finally {
			setBusy("");
		}
	}
	const create = (kind = "daily") => setEditor({ kind });
	const viewSession = (id) => {
		setEditor(null);
		selectSession(id);
		void navigate({ to: "/tasks" });
	};
	return (
		<section className="automation-page" aria-label="Schedules">
			<MotionConfig reducedMotion="user">
				<ShapeProvider defaultShape="rounded">
					<div className="fluid-scope automation-canvas">
						<div className="automation-toolbar">
							<InputGroup className="automation-search" size="default">
								<InputField
									label="Search automations"
									labelHidden
									index={0}
									type="search"
									value={query}
									onChange={setQuery}
									placeholder="Search automations…"
								/>
							</InputGroup>
							<Button
								size="default"
								className="automation-create"
								variant="primary"
								aria-label="New automation"
								title="New automation"
								onClick={() => create()}
								disabled={loading}
							>
								New automation
							</Button>
						</div>
						{(error || storeError) && (
							<div
								className="automation-error automation-page-error"
								role="alert"
							>
								<span>{storeError || error}</span>
								{!storeError && (
									<Button
										variant="ghost"
										size="icon-compact"
										aria-label="Dismiss error"
										onClick={() => setError("")}
									>
										<X size={14} />
									</Button>
								)}
							</div>
						)}
						<section className="automation-list" aria-label="Schedules">
							{loading ? (
								<div className="automation-list-empty">Loading schedules…</div>
							) : !options.repositories.length ? (
								<div className="automation-list-empty">
									Connect a repository to schedule work.
								</div>
							) : !matching.length ? (
								<div className="automation-list-empty">
									{query
										? "No matching schedules."
										: "No automations yet. Create one to get started."}
								</div>
							) : (
								matching.map((d) => (
									<button
										type="button"
										key={d.id}
										className="automation-row"
										aria-label={`View ${d.name}`}
										aria-haspopup="dialog"
										onClick={() => {
											setSelected(d.id);
											setEditor({ definition: d });
										}}
									>
										<span className="automation-row-name">
											<strong>{d.name}</strong>
											<span>
												{d.target?.kind === "direct_ops"
													? "No repository"
													: options.repositories.find(
															(r) => r.id === d.repositoryId,
														)?.name || d.repositoryId}
											</span>
										</span>
										<span className="automation-row-schedule">
											{scheduleLabel(d)}
											<span>{d.timezone}</span>
										</span>
										<span className="automation-row-next">
											{d.nextRunAt
												? `Next ${formatDate(d.nextRunAt, d.timezone, true)}`
												: "No upcoming runs"}
										</span>
										<StatusBadge status={d.scheduleState} />
										<ChevronRight size={15} />
									</button>
								))
							)}
						</section>
						<footer className="automation-page-footer">
							<ShieldCheck size={13} />
							<span>Schedules run while Miko is online.</span>
						</footer>
					</div>
					{editor && (
						<AutomationEditor
							key={editor.definition?.id || "new"}
							{...editor}
							definition={
								editor.definition ? definition || editor.definition : undefined
							}
							options={options}
							onClose={() => {
								setEditor(null);
								setSelected(null);
							}}
							onSaved={async (saved) => {
								await reload();
								setQuery("");
								setSelected(saved.id);
								setEditor(null);
								setRunVersion((v) => v + 1);
							}}
						>
							{definition && editor.definition && (
								<AutomationActivity
									definition={definition}
									runs={runs}
									loading={runsLoading}
									onAction={perform}
									onSession={viewSession}
									busy={busy}
								/>
							)}
						</AutomationEditor>
					)}
					<Dialog
						open={!!confirmation}
						onOpenChange={(open) => {
							if (!open && busy !== "confirm") setConfirmation(null);
						}}
					>
						<DialogContent className="fluid-scope automation-confirm">
							<DialogHeader>
								<DialogTitle>
									{confirmation?.action === "archive"
										? "Archive this automation?"
										: "Has the execution ended?"}
								</DialogTitle>
								<DialogDescription>
									{confirmation?.action === "archive"
										? "Future scheduled runs will stop. Current work continues and all run history is kept."
										: "Only confirm after checking that the previous agent has stopped. This releases the schedule for future runs; it does not stop a running agent."}
								</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<Button
									variant="ghost"
									onClick={() => setConfirmation(null)}
									disabled={busy === "confirm"}
								>
									Cancel
								</Button>
								<Button loading={busy === "confirm"} onClick={confirm}>
									{confirmation?.action === "archive"
										? "Archive automation"
										: "Confirm ended"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</ShapeProvider>
			</MotionConfig>
		</section>
	);
}
