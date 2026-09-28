import {
	BookOpen,
	Check,
	Copy,
	FolderOpen,
	RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
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
import { ShapeProvider } from "./fluid/lib/shape-context";
import "./fluid/theme.css";
import "./skills.css";

const sourceLabels = {
	internal: "Bundled",
	user: "User",
	repo: "Repo",
};
const sourceColors = {
	internal: "blue",
	user: "green",
	repo: "gray",
};
const sourceFilters = [
	{ id: "all", label: "All" },
	{ id: "internal", label: "Bundled" },
	{ id: "user", label: "User" },
	{ id: "repo", label: "Repo" },
];

async function copyText(value) {
	try {
		await navigator.clipboard.writeText(value);
		return true;
	} catch {
		const area = document.createElement("textarea");
		area.value = value;
		area.setAttribute("readonly", "");
		area.style.position = "fixed";
		area.style.left = "-9999px";
		document.body.append(area);
		area.select();
		const ok = document.execCommand("copy");
		area.remove();
		return ok;
	}
}

function skillKey(skill) {
	return `${skill.source}:${skill.origin}:${skill.name}`;
}

function SkillsApp() {
	const [skills, setSkills] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [query, setQuery] = useState("");
	const [sourceFilter, setSourceFilter] = useState("all");
	const [selected, setSelected] = useState(null);
	const [busy, setBusy] = useState("");
	const [copied, setCopied] = useState("");
	const [message, setMessage] = useState("");

	const reload = useCallback(async (signal) => {
		const response = await fetch("/board/api/skills", {
			cache: "no-store",
			signal,
		});
		if (!response.ok) throw new Error("Cannot load skills");
		return response.json();
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		reload(controller.signal)
			.then((data) => {
				if (!controller.signal.aborted) {
					setSkills(data.skills || []);
					setError("");
					setLoading(false);
				}
			})
			.catch((err) => {
				if (!controller.signal.aborted) {
					setError(err.message || "Cannot load skills");
					setLoading(false);
				}
			});
		return () => controller.abort();
	}, [reload]);

	const counts = useMemo(() => {
		const next = { all: skills.length, internal: 0, user: 0, repo: 0 };
		for (const skill of skills) {
			if (next[skill.source] !== undefined) next[skill.source] += 1;
		}
		return next;
	}, [skills]);

	const matching = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return skills.filter((skill) => {
			if (sourceFilter !== "all" && skill.source !== sourceFilter) return false;
			if (!needle) return true;
			return [skill.name, skill.description, skill.origin, skill.source]
				.join(" ")
				.toLowerCase()
				.includes(needle);
		});
	}, [skills, query, sourceFilter]);

	const detail = matching.find((skill) => skillKey(skill) === selected);

	useEffect(() => {
		if (!selected) return;
		if (!matching.some((skill) => skillKey(skill) === selected))
			setSelected(null);
	}, [matching, selected]);

	async function openSkill(skill) {
		const key = skillKey(skill);
		setBusy(key);
		setMessage("");
		try {
			const response = await fetch("/board/api/open-skill", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					source: skill.source,
					name: skill.name,
					repository: skill.source === "repo" ? skill.origin : undefined,
				}),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error || "Cannot open skill");
			setMessage(
				body.opened
					? `Opened ${body.path}`
					: `Path ready to copy: ${body.path}`,
			);
			if (!body.opened) {
				await copyText(body.path);
				setCopied(key);
				setTimeout(() => setCopied(""), 1500);
			}
		} catch (err) {
			setMessage(err.message || "Cannot open skill");
		} finally {
			setBusy("");
		}
	}

	async function copyPath(skill) {
		const key = skillKey(skill);
		const ok = await copyText(skill.path);
		setCopied(ok ? key : "");
		setMessage(ok ? `Copied ${skill.path}` : "Could not copy path");
		if (ok) setTimeout(() => setCopied(""), 1500);
	}

	return (
		<ShapeProvider defaultShape="rounded">
			<div className="fluid-scope skills-canvas">
				<header className="skills-header">
					<div>
						<h1>Skills</h1>
						<p className="skills-subtitle">
							Bundled, user, and repo-local skills currently available to Miko.
						</p>
					</div>
					<Button
						variant="ghost"
						leadingIcon={RefreshCw}
						onClick={() => {
							setLoading(true);
							reload()
								.then((data) => {
									setSkills(data.skills || []);
									setError("");
								})
								.catch((err) =>
									setError(err.message || "Cannot load skills"),
								)
								.finally(() => setLoading(false));
						}}
					>
						Refresh
					</Button>
				</header>

				<div className="skills-toolbar">
					<InputGroup className="skills-search" size="default">
						<InputField
							label="Search skills"
							labelHidden
							index={0}
							type="search"
							value={query}
							onChange={setQuery}
							placeholder="Search skills…"
						/>
					</InputGroup>
					<div className="skills-filters" role="tablist" aria-label="Skill source">
						{sourceFilters.map((filter) => (
							<button
								key={filter.id}
								type="button"
								role="tab"
								aria-selected={sourceFilter === filter.id}
								className={`skills-filter${sourceFilter === filter.id ? " selected" : ""}`}
								onClick={() => setSourceFilter(filter.id)}
							>
								{filter.label}
								<span>{counts[filter.id] ?? 0}</span>
							</button>
						))}
					</div>
					<span className="skills-count">
						{loading
							? "Loading…"
							: `${matching.length} skill${matching.length === 1 ? "" : "s"}`}
					</span>
				</div>

				{error && (
					<div className="skills-banner skills-banner-error" role="alert">
						{error}
					</div>
				)}
				{message && !error && (
					<div className="skills-banner" role="status">
						{message}
					</div>
				)}

				{loading && !skills.length ? (
					<div className="skills-empty">Loading skills…</div>
				) : !matching.length ? (
					<div className="skills-empty">
						{query || sourceFilter !== "all"
							? "No matching skills."
							: "No skills found."}
					</div>
				) : (
					<section className="skills-grid" aria-label="Skills">
						{matching.map((skill) => {
							const key = skillKey(skill);
							return (
								<button
									type="button"
									key={key}
									className="skills-card"
									onClick={() => setSelected(key)}
								>
									<div className="skills-card-top">
										<strong className="skills-card-name">{skill.name}</strong>
										<div className="skills-card-badges">
											<Badge
												variant="dot"
												color={sourceColors[skill.source] || "gray"}
												size="compact"
											>
												{sourceLabels[skill.source] || skill.source}
											</Badge>
											{!skill.active && (
												<Badge variant="dot" color="orange" size="compact">
													Shadowed
												</Badge>
											)}
										</div>
									</div>
									<p className="skills-card-description">
										{skill.description || "No description in SKILL.md"}
									</p>
									{skill.source === "repo" && (
										<span className="skills-card-origin" title={skill.origin}>
											{skill.origin}
										</span>
									)}
								</button>
							);
						})}
					</section>
				)}

				<Dialog
					open={!!detail}
					onOpenChange={(open) => {
						if (!open) setSelected(null);
					}}
				>
					{detail && (
						<DialogContent size="lg" className="fluid-scope skills-dialog">
							<DialogHeader>
								<DialogTitle className="skills-dialog-title">
									<BookOpen size={18} aria-hidden="true" />
									<span>{detail.name}</span>
								</DialogTitle>
								<DialogDescription>
									{detail.source === "repo"
										? `Repo skill from ${detail.origin}`
										: detail.source === "user"
											? "User skill override"
											: "Bundled with Miko"}
								</DialogDescription>
							</DialogHeader>

							<div className="skills-dialog-badges">
								<Badge
									variant="dot"
									color={sourceColors[detail.source] || "gray"}
									size="compact"
								>
									{sourceLabels[detail.source] || detail.source}
								</Badge>
								<Badge
									variant="dot"
									color={detail.active ? "green" : "orange"}
									size="compact"
								>
									{detail.active ? "Active" : "Shadowed by user skill"}
								</Badge>
							</div>

							<p className="skills-dialog-description">
								{detail.description || "No description in SKILL.md"}
							</p>

							<div className="skills-dialog-meta">
								<span>Path</span>
								<code className="skills-dialog-path" title={detail.path}>
									{detail.path}
								</code>
								{detail.source === "repo" && (
									<>
										<span>Repository</span>
										<strong title={detail.origin}>{detail.origin}</strong>
									</>
								)}
								{detail.source === "user" && (
									<>
										<span>Origin</span>
										<strong>User skills directory</strong>
									</>
								)}
								{detail.source === "internal" && (
									<>
										<span>Origin</span>
										<strong title={detail.origin}>{detail.origin}</strong>
									</>
								)}
							</div>

							{!detail.active && (
								<div className="skills-dialog-note" role="note">
									This skill is shadowed by a user skill with the same name and
									is not active.
								</div>
							)}

							<DialogFooter className="skills-dialog-actions">
								<Button
									variant="ghost"
									size="compact"
									leadingIcon={
										copied === skillKey(detail) ? Check : Copy
									}
									onClick={() => copyPath(detail)}
								>
									{copied === skillKey(detail) ? "Copied" : "Copy path"}
								</Button>
								<Button
									variant="secondary"
									size="compact"
									leadingIcon={FolderOpen}
									loading={busy === skillKey(detail)}
									disabled={busy === skillKey(detail)}
									onClick={() => openSkill(detail)}
								>
									Open folder
								</Button>
							</DialogFooter>
						</DialogContent>
					)}
				</Dialog>
			</div>
		</ShapeProvider>
	);
}

export function initializeSkills() {
	createRoot(document.getElementById("skills")).render(<SkillsApp />);
}
