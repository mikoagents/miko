import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBoardSession } from "./board-session.jsx";
import { LogViewerHost } from "./log-viewer.jsx";

import {
	ago,
	canLinkLinearIssue,
	clock,
	connectionText,
	duration,
	fastLabel,
	filterTasks,
	isStale,
	STATUS_NAMES,
} from "./tasks-model.mjs";

function LinearIssueLink({ identifier, workspaceSlug }) {
	if (!canLinkLinearIssue(identifier, workspaceSlug)) return null;
	return (
		<a
			className="task-issue-link"
			href={`https://linear.app/${encodeURIComponent(workspaceSlug)}/issue/${encodeURIComponent(identifier)}/`}
			target="_blank"
			rel="noopener noreferrer"
			title={`Open ${identifier} in Linear`}
			aria-label={`Open ${identifier} in Linear (new tab)`}
			onClick={(event) => event.stopPropagation()}
		>
			<HugeiconsIcon
				icon={ArrowUpRight01Icon}
				size={14}
				strokeWidth={2}
				aria-hidden="true"
				focusable="false"
			/>
		</a>
	);
}

function TaskCard({ task, selected, stale, onSelect }) {
	const isSelected = selected === task.id;
	const status = stale && task.status === "running" ? "unknown" : task.status;
	const statusLabel =
		stale && task.status === "running"
			? "Previously running"
			: STATUS_NAMES[task.status] || task.status;
	return (
		<div className={`task${isSelected ? " selected" : ""}`}>
			<button
				type="button"
				className="task-select"
				aria-pressed={String(isSelected)}
				aria-label={`View logs for ${task.issue || "task"}: ${task.title || "Loading task title"}`}
				title={
					task.reason +
					(task.quiet ? " · No activity for over 2 minutes" : "") +
					`\nModel: ${task.model || "Unknown"}` +
					`\nReasoning effort: ${task.reasoningEffort || "Unknown"}` +
					(task.fastMode === true ? "\nFast" : "") +
					"\nSession " +
					task.id
				}
				onClick={() => onSelect(task)}
			/>
			<div className="task-top">
				<div className="task-identifier">
					<span className="issue">{task.issue || "Untitled task"}</span>
					<LinearIssueLink
						identifier={task.issue}
						workspaceSlug={task.linearWorkspaceSlug}
					/>
				</div>
				<span className="task-time">
					{task.status === "running"
						? duration(task.turnStartedAt)
						: clock(task.lastActivityAt)}
				</span>
			</div>
			<div className="task-title">{task.title || "Loading task title"}</div>
			<div className="task-meta">
				<div className="task-context">
					<span className="task-repository">
						{(task.repositories?.join(", ") || "Repository unconfirmed") +
							(task.archived ? " · Archived" : "")}
					</span>
					<span className="task-model">
						{`${task.model || "Model unknown"} · ${task.reasoningEffort || "Effort unknown"}${fastLabel(task)}`}
					</span>
				</div>
				<span className={`pill ${status}`}>{statusLabel}</span>
			</div>
		</div>
	);
}

export function TasksPage() {
	const { selectedId, setSelectedId } = useBoardSession();
	const [latest, setLatest] = useState(null);
	const [displayed, setDisplayed] = useState(null);
	const [paused, setPaused] = useState(false);
	const [connected, setConnected] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [query, setQuery] = useState("");
	const [warnings, setWarnings] = useState("");
	const [controls, setControls] = useState({
		source: "all",
		errorsOnly: false,
		follow: true,
		wrap: true,
	});
	const [now, setNow] = useState(() => Date.now());
	const historyRef = useRef(new Map());
	const pausedRef = useRef(false);
	const selectedRef = useRef(selectedId);
	const [, setHistoryVersion] = useState(0);
	pausedRef.current = paused;
	selectedRef.current = selectedId;

	const bumpHistory = useCallback(() => {
		setHistoryVersion((v) => v + 1);
	}, []);

	const loadHistory = useCallback(
		async (task) => {
			if (!task?.archived || historyRef.current.has(task.id)) return;
			try {
				const response = await fetch(
					`/board/api/history/${encodeURIComponent(task.id)}`,
					{ cache: "no-store" },
				);
				if (!response.ok) throw Error();
				historyRef.current.set(task.id, {
					at: task.lastActivityAt,
					logs: (await response.json()).logs,
				});
				bumpHistory();
			} catch {
				setWarnings("Cannot load archived logs. Select the task to retry.");
			}
		},
		[bumpHistory],
	);

	const applySnapshot = useCallback(
		(data) => {
			setDisplayed(data);
			for (const [id, cached] of historyRef.current) {
				const task = data.tasks?.find((t) => t.id === id);
				if (!task?.archived || task.lastActivityAt !== cached.at)
					historyRef.current.delete(id);
			}
			setWarnings((data.warnings || []).join(" "));
			void loadHistory(data.tasks?.find((t) => t.id === selectedRef.current));
		},
		[loadHistory],
	);

	useEffect(() => {
		const stream = new EventSource("/board/events");
		stream.onopen = () => setConnected(true);
		stream.onerror = () => setConnected(false);
		stream.addEventListener("unavailable", () => setConnected(false));
		stream.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				setLatest(data);
				setConnected(true);
				if (!pausedRef.current) applySnapshot(data);
			} catch {
				setWarnings(
					"Incomplete update received. Waiting for the next refresh.",
				);
			}
		};
		return () => stream.close();
	}, [applySnapshot]);

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 3000);
		return () => clearInterval(timer);
	}, []);

	const refresh = useCallback(async () => {
		if (refreshing) return;
		setRefreshing(true);
		try {
			const response = await fetch("/board/api/snapshot", {
				cache: "no-store",
			});
			if (!response.ok) throw Error();
			const data = await response.json();
			setLatest(data);
			setPaused(false);
			applySnapshot(data);
		} catch {
			setWarnings("Cannot reach the monitor. Reconnecting automatically.");
		} finally {
			setRefreshing(false);
		}
	}, [applySnapshot, refreshing]);

	const tasks = useMemo(
		() => filterTasks(displayed?.tasks, query),
		[displayed, query],
	);
	void now;
	const stale = isStale(displayed);
	const connection = connectionText({ connected, paused, latest });
	const selectedTask = displayed?.tasks?.find((t) => t.id === selectedId);

	const taskDetail = selectedTask
		? `${selectedTask.issue || "Task"} · ` +
			(selectedTask.model || "Unknown model") +
			" · " +
			(selectedTask.reasoningEffort || "Effort unknown") +
			fastLabel(selectedTask) +
			" · " +
			(STATUS_NAMES[selectedTask.status] || selectedTask.status) +
			" · Last activity " +
			ago(selectedTask.lastActivityAt) +
			(selectedTask.archived ? " · Archived · Up to 100 recent entries" : "") +
			(selectedTask.quiet ? " · No activity for over 2 minutes" : "")
		: "";

	const logs = (
		selectedTask?.archived
			? historyRef.current.get(selectedTask.id)?.logs || []
			: displayed?.logs || []
	).filter(
		(l) =>
			(!selectedTask ||
				(l.sessionId
					? l.sessionId === selectedTask.id
					: l.issue === selectedTask.issue)) &&
			(controls.source === "all" || l.source === controls.source),
	);

	return (
		<main id="tasks-page">
			<aside className="sidebar" aria-label="Task list">
				<div className="sidebar-tools">
					<div
						className="sr-only"
						role="status"
						title={`${connection} · ${
							!connected || isStale(latest)
								? "Waiting for fresh data"
								: "Live connection"
						} · Last collected ${clock(latest?.collectedAt)}`}
					>
						{connection}
					</div>
					<label className="search">
						<span className="sr-only">Search tasks</span>
						<input
							id="task-search"
							type="search"
							placeholder="Search tasks…"
							autoComplete="off"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
					</label>
				</div>
				<div className="task-list" id="tasks">
					{!tasks.length ? (
						<div className="empty">
							{query.trim() ? "No matching tasks" : "No tasks yet"}
						</div>
					) : (
						tasks.map((task) => (
							<TaskCard
								key={task.id}
								task={task}
								selected={selectedId}
								stale={stale}
								onSelect={(t) => {
									setSelectedId(selectedId === t.id ? null : t.id);
									void loadHistory(t);
								}}
							/>
						))
					)}
				</div>
			</aside>
			<section className="log-pane" aria-label="Live logs">
				<div className="warn" id="warnings" role="status">
					{warnings}
				</div>
				<LogViewerHost
					logs={logs}
					source={controls.source}
					errorsOnly={controls.errorsOnly}
					follow={controls.follow}
					wrap={controls.wrap}
					paused={paused}
					refreshing={refreshing}
					taskDetail={taskDetail}
					showIssue={!selectedTask}
					scope={[selectedId, controls.source, controls.errorsOnly].join("|")}
					onStopFollowing={() => setControls((c) => ({ ...c, follow: false }))}
					onControlsChange={(patch) => setControls((c) => ({ ...c, ...patch }))}
					onPause={() => {
						const next = !pausedRef.current;
						setPaused(next);
						if (!next && latest) applySnapshot(latest);
					}}
					onRefresh={refresh}
					onClearTask={() => setSelectedId(null)}
				/>
			</section>
		</main>
	);
}
