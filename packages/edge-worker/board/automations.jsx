import { MotionConfig } from "framer-motion";
import {
	Activity,
	Archive,
	ArrowDownLeft,
	BookOpen,
	CalendarClock,
	Check,
	ChevronRight,
	Clock3,
	ExternalLink,
	ListTodo,
	Pause,
	Play,
	Plus,
	ShieldCheck,
	X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import mikoLogo from "./assets/miko.jpg";
import {
	AutomationModelIcon,
	AutomationRunnerIcon,
} from "./automation-icons.jsx";
import {
	automationApi as api,
	formatDate,
	formatRepositoryNames,
	formFromDefinition,
	formWithRepositories,
	formWithTarget,
	formWithTeam,
	inputFromForm,
	modelChoices,
	RUNNER_LABELS,
	resolveAutomationModel,
	runLabels,
	scheduleFromForm,
	scheduleLabel,
	statusColors,
} from "./automation-model.mjs";
import {
	boardPageFromHash,
	boardPageHref,
	redirectLegacyBoardHash,
} from "./board-route.mjs";
import { Badge } from "./fluid/components/ui/badge";
import { Button } from "./fluid/components/ui/button";
import {
	Combobox,
	ComboboxChips,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "./fluid/components/ui/combobox";
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
function FormInput({ label, id: providedId, onChange, className, ...props }) {
	return (
		<InputGroup className={className || "automation-input-group w-full"} size="compact">
			<InputField
				id={providedId}
				label={label}
				index={0}
				onChange={onChange}
				{...props}
			/>
		</InputGroup>
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
			<Select
				value={value}
				onValueChange={onChange}
				disabled={disabled}
				size="compact"
			>
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

function FieldCombobox({
	label,
	value,
	onChange,
	items,
	placeholder = "Search…",
	multiple = false,
	hideSelected = false,
	onCreate,
	disabled = false,
	error = "",
	clearable = false,
	renderItem,
}) {
	const id = useId();
	return (
		<div className="automation-field">
			<label id={`${id}-label`} htmlFor={id}>
				{label}
			</label>
			<Combobox
				items={items}
				multiple={multiple}
				hideSelected={hideSelected}
				value={value}
				onValueChange={onChange}
				onCreate={onCreate}
				disabled={disabled}
				size="compact"
			>
				{multiple ? (
					<ComboboxChips
						id={id}
						aria-labelledby={`${id}-label`}
						placeholder={placeholder}
						error={error || undefined}
						clearable={clearable}
						className="automation-combobox"
					/>
				) : (
					<ComboboxInput
						id={id}
						aria-labelledby={`${id}-label`}
						placeholder={placeholder}
						error={error || undefined}
						clearable={clearable}
						className="automation-combobox"
					/>
				)}
				<ComboboxContent className="fluid-scope">
					<ComboboxEmpty
						allSelected={multiple ? "Everything selected." : undefined}
					>
						No matches.
					</ComboboxEmpty>
					<ComboboxList>
						{(item) => {
							const itemValue = typeof item === "string" ? item : item.value;
							const itemLabel = typeof item === "string" ? item : item.label;
							return (
								<ComboboxItem key={itemValue} value={itemValue}>
									{renderItem ? renderItem(item) : itemLabel}
								</ComboboxItem>
							);
						}}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
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
			if (input.target.kind === "github_issue") {
				const missing = (input.repositoryIds || []).filter((id) => {
					const repository = options.repositories.find((r) => r.id === id);
					return !repository?.githubUrl;
				});
				if (missing.length)
					throw new Error(
						"Choose repositories that have a GitHub URL configured.",
					);
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
							? "Archived schedule"
							: definition
								? "Edit schedule"
								: "New schedule"}
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
						<Tabs value={panel} onValueChange={setPanel} size="compact">
							<TabsList aria-label="Schedule details">
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
								<FormInput
									id="automation-name"
									label="Name"
									placeholder="e.g. Review dependencies every Monday"
									value={form.name}
									onChange={(value) => set("name", value)}
									required
									maxLength={200}
								/>
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
											<FieldCombobox
												label="Repositories"
												multiple
												hideSelected
												clearable
												placeholder="Choose repositories"
												items={options.repositories.map((repository) => ({
													value: repository.id,
													label: repository.name,
												}))}
												value={form.repositoryIds || []}
												onChange={(nextIds) => {
													const ids = Array.isArray(nextIds) ? nextIds : [];
													const selected = ids
														.map((id) =>
															options.repositories.find(
																(repository) => repository.id === id,
															),
														)
														.filter(Boolean);
													setForm((current) =>
														formWithRepositories(current, selected),
													);
												}}
												error={
													form.target === "linear_issue" &&
													(form.repositoryIds || []).length > 1 &&
													!form.workspaceId
														? "Selected repositories must share one Linear workspace."
														: form.target === "github_issue" &&
															  (form.repositoryIds || []).some((id) => {
																	const repository = options.repositories.find(
																		(r) => r.id === id,
																	);
																	return !repository?.githubUrl;
															  })
															? "Selected repositories need a GitHub URL."
															: ""
												}
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
												["github_issue", "Create GitHub issue"],
											]}
										/>
									</div>
									<div className="automation-form-grid">
										<FieldCombobox
											label="Agent"
											clearable
											placeholder="Choose an agent"
											items={[
												{
													value: "default",
													label: options.defaultRunner
														? `Default (${RUNNER_LABELS[options.defaultRunner] || options.defaultRunner})`
														: "Default",
												},
												...(options.runners || Object.keys(RUNNER_LABELS)).map(
													(runner) => ({
														value: runner,
														label: RUNNER_LABELS[runner] || runner,
													}),
												),
											]}
											value={form.runner || "default"}
											onChange={(next) =>
												setForm((current) => ({
													...current,
													runner: !next || next === "default" ? "" : next,
												}))
											}
											renderItem={(item) => (
												<span className="automation-combobox-option">
													{item.value !== "default" && (
														<AutomationRunnerIcon
															runner={item.value}
															size={14}
														/>
													)}
													<span>{item.label}</span>
												</span>
											)}
										/>
										<FieldCombobox
											label="Model"
											clearable
											placeholder={
												(form.runner && options.defaultModels?.[form.runner]) ||
												(options.defaultRunner &&
													options.defaultModels?.[options.defaultRunner]) ||
												"Default for agent"
											}
											items={(() => {
												const suggestions = modelChoices(options, form.runner);
												const values = [...suggestions];
												const current = form.model?.trim();
												if (current && !values.includes(current))
													values.unshift(current);
												return values.map((model) => ({
													value: model,
													label: model,
												}));
											})()}
											value={form.model || ""}
											onChange={(next) =>
												set("model", typeof next === "string" ? next : "")
											}
											onCreate={(query) => {
												const trimmed = query.trim().slice(0, 200);
												if (!trimmed || /[\s[\]]/.test(trimmed)) return;
												return { value: trimmed, label: trimmed };
											}}
											renderItem={(item) => (
												<span className="automation-combobox-option">
													<AutomationModelIcon model={item.value} size={14} />
													<span>{item.label}</span>
												</span>
											)}
										/>
									</div>
									<p className="automation-field-hint">
										{form.target === "direct_repository"
											? "One isolated worktree session per selected repository. Agent and model override the install defaults for this schedule."
											: form.target === "direct_ops"
												? "Runs in a separate workspace without cloning a repository. Use for Linear operations and other tasks outside a code repository."
												: form.target === "github_issue"
													? "Creates a GitHub issue on each selected repository via the GitHub App, then starts the agent in that repo. Multi-repo fans out one issue and session per repository."
													: "Creates an issue in the selected repositories' shared Linear workspace and delegates it to your connected Miko agent. Agent and model are applied as routing tags."}
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
														? "Select repositories that share a Linear workspace"
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
									{form.kind === "weekly" && (
										<fieldset className="automation-weekdays">
											<legend>Run on</legend>
											<div>
												{[1, 2, 3, 4, 5, 6, 0].map((day) => (
													<Button
														key={day}
														type="button"
														size="compact"
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
									<FormInput
										label="Timezone"
										value={form.timezone}
										onChange={(value) => set("timezone", value)}
										readOnly={form.kind === "once"}
										required
									/>
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
										size="compact"
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
							size="compact"
							onClick={onClose}
							disabled={saving}
						>
							{panel === "history" || definition?.archived ? "Close" : "Cancel"}
						</Button>
						{panel === "configuration" && !definition?.archived && (
							<Button
								type="submit"
								size="compact"
								leadingIcon={definition ? Check : Plus}
								loading={saving}
								disabled={
									definition?.archived ||
									(form.target !== "direct_ops" &&
										!(form.repositoryIds || []).length) ||
									!preview.times.length ||
									preview.loading ||
									teamsLoading
								}
							>
								{definition ? "Save changes" : "Create schedule"}
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
			aria-label="Schedule activity"
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
							title="Archive schedule"
							aria-label="Archive schedule"
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

function AutomationsApp({ onSession }) {
	const [page, setPage] = useState(() =>
		boardPageFromHash(window.location.hash),
	);
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
		document.getElementById("tasks-page").hidden = page !== "tasks";
		document.getElementById("automations").hidden = page !== "automations";
		document.getElementById("status").hidden = page !== "status";
		document.getElementById("skills").hidden = page !== "skills";
		if (page !== "automations") return;
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
	}, [page, reload]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runVersion explicitly refreshes history after a mutation.
	useEffect(() => {
		if (!selected || !editor?.definition || page !== "automations") {
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
	}, [selected, page, runVersion, editor?.definition?.id]);
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
	useEffect(() => {
		const onRouteChange = () => {
			redirectLegacyBoardHash();
			setPage(boardPageFromHash(window.location.hash));
			setEditor(null);
			setConfirmation(null);
		};
		redirectLegacyBoardHash();
		window.addEventListener("hashchange", onRouteChange);
		return () => window.removeEventListener("hashchange", onRouteChange);
	}, []);
	useEffect(() => {
		const titles = {
			tasks: "Miko · Tasks & Logs",
			automations: "Miko · Schedules",
			status: "Miko · Status",
			skills: "Miko · Skills",
		};
		document.title = titles[page] || titles.tasks;
	}, [page]);
	const create = (kind = "daily") => setEditor({ kind });
	const viewSession = (id) => {
		setEditor(null);
		window.location.hash = boardPageHref("tasks");
		setPage("tasks");
		onSession(id);
	};
	return (
		<MotionConfig reducedMotion="user">
			<ShapeProvider defaultShape="rounded">
				{createPortal(
					<div className="fluid-scope automation-navigation">
						<a
							className="automation-brand"
							href="/board"
							aria-label="Miko home"
						>
							<span className="automation-brand-mark" aria-hidden="true">
								<img src={mikoLogo} alt="" />
							</span>
							<span>Miko</span>
						</a>
						<div className="automation-nav-items">
							<Button
								id="show-tasks"
								variant="ghost"
								size="compact"
								active={page === "tasks"}
								leadingIcon={ListTodo}
								asChild
								aria-current={page === "tasks" ? "page" : undefined}
							>
								<a href={boardPageHref("tasks")}>Tasks & logs</a>
							</Button>
							<Button
								id="show-automations"
								variant="ghost"
								size="compact"
								active={page === "automations"}
								leadingIcon={CalendarClock}
								asChild
								aria-current={page === "automations" ? "page" : undefined}
							>
								<a href={boardPageHref("automations")}>Schedules</a>
							</Button>
							<Button
								id="show-skills"
								variant="ghost"
								size="compact"
								active={page === "skills"}
								leadingIcon={BookOpen}
								asChild
								aria-current={page === "skills" ? "page" : undefined}
							>
								<a href={boardPageHref("skills")}>Skills</a>
							</Button>
							<Button
								id="show-status"
								variant="ghost"
								size="compact"
								active={page === "status"}
								leadingIcon={Activity}
								asChild
								aria-current={page === "status" ? "page" : undefined}
							>
								<a href={boardPageHref("status")}>Status</a>
							</Button>
						</div>
						<span className="automation-local">
							<span />
							Local workspace
						</span>
					</div>,
					document.getElementById("board-navigation"),
				)}
				<div className="fluid-scope automation-canvas">
					<div className="automation-toolbar">
						<InputGroup className="automation-search" size="compact">
							<InputField
								label="Search schedules"
								labelHidden
								index={0}
								type="search"
								value={query}
								onChange={setQuery}
								placeholder="Search schedules…"
							/>
						</InputGroup>
						<Button
							size="compact"
							className="automation-create"
							variant="primary"
							aria-label="New schedule"
							title="New schedule"
							onClick={() => create()}
							disabled={loading}
						>
							New schedule
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
									: "No schedules yet. Create one to get started."}
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
									<span className="automation-row-name" title={d.name}>
										{d.name}
									</span>
									<span
										className="automation-row-meta"
										title={formatRepositoryNames(d, options.repositories)}
									>
										{formatRepositoryNames(d, options.repositories)}
									</span>
									<span
										className="automation-row-model"
										title={resolveAutomationModel(d, options)}
									>
										<AutomationModelIcon
											model={resolveAutomationModel(d, options)}
											size={12}
										/>
										<span>{resolveAutomationModel(d, options)}</span>
									</span>
									<span
										className="automation-row-schedule"
										title={`${scheduleLabel(d)} · ${d.timezone}`}
									>
										{scheduleLabel(d)}
									</span>
									<span
										className="automation-row-next"
										title={
											d.nextRunAt
												? formatDate(d.nextRunAt, d.timezone, true)
												: "No upcoming runs"
										}
									>
										{d.nextRunAt
											? formatDate(d.nextRunAt, d.timezone, true)
											: "—"}
									</span>
									<span className="automation-row-status">
										<StatusBadge status={d.scheduleState} />
									</span>
									<ChevronRight size={15} aria-hidden />
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
							setFilter("active");
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
									? "Archive this schedule?"
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
								size="compact"
								onClick={() => setConfirmation(null)}
								disabled={busy === "confirm"}
							>
								Cancel
							</Button>
							<Button
								size="compact"
								loading={busy === "confirm"}
								onClick={confirm}
							>
								{confirmation?.action === "archive"
									? "Archive schedule"
									: "Confirm ended"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</ShapeProvider>
		</MotionConfig>
	);
}

export function initializeAutomations(onSession) {
	createRoot(document.getElementById("automations")).render(
		<AutomationsApp onSession={onSession} />,
	);
}
