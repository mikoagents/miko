import {
	BookOpen,
	Check,
	Copy,
	FolderOpen,
	RefreshCw,
	Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "./fluid/components/ui/badge";
import { Button } from "./fluid/components/ui/button";
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

function SkillsApp() {
	const [skills, setSkills] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [query, setQuery] = useState("");
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

	const matching = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return skills.filter(
			(skill) =>
				!needle ||
				[skill.name, skill.description, skill.origin, skill.source]
					.join(" ")
					.toLowerCase()
					.includes(needle),
		);
	}, [skills, query]);

	useEffect(() => {
		if (!selected) return;
		if (!matching.some((skill) => skillKey(skill) === selected))
			setSelected(null);
	}, [matching, selected]);

	const detail = matching.find((skill) => skillKey(skill) === selected);

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
						<p className="skills-kicker">Local board</p>
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
				<div className="skills-body">
					<section className="skills-list" aria-label="Skills">
						{loading && !skills.length ? (
							<div className="skills-empty">Loading skills…</div>
						) : !matching.length ? (
							<div className="skills-empty">
								{query ? "No matching skills." : "No skills found."}
							</div>
						) : (
							matching.map((skill) => {
								const key = skillKey(skill);
								return (
									<button
										type="button"
										key={key}
										className={`skills-row${selected === key ? " selected" : ""}`}
										aria-pressed={selected === key}
										onClick={() =>
											setSelected(selected === key ? null : key)
										}
									>
										<span className="skills-row-main">
											<strong>{skill.name}</strong>
											<span>
												{skill.description || "No description in SKILL.md"}
											</span>
										</span>
										<span className="skills-row-meta">
											<Badge
												variant="dot"
												color={sourceColors[skill.source] || "gray"}
												size="compact"
											>
												{sourceLabels[skill.source] || skill.source}
											</Badge>
											{!skill.active && (
												<Badge variant="dot" color="gray" size="compact">
													Shadowed
												</Badge>
											)}
											<span>{skill.origin}</span>
										</span>
									</button>
								);
							})
						)}
					</section>
					<aside className="skills-detail" aria-label="Skill detail">
						{detail ? (
							<>
								<div className="skills-detail-header">
									<BookOpen size={18} />
									<div>
										<h2>{detail.name}</h2>
										<p>{detail.origin}</p>
									</div>
								</div>
								<div className="skills-detail-badges">
									<Badge
										variant="dot"
										color={sourceColors[detail.source] || "gray"}
										size="compact"
									>
										{sourceLabels[detail.source] || detail.source}
									</Badge>
									<Badge
										variant="dot"
										color={detail.active ? "green" : "gray"}
										size="compact"
									>
										{detail.active ? "Active" : "Shadowed by user skill"}
									</Badge>
								</div>
								<p className="skills-detail-description">
									{detail.description || "No description in SKILL.md"}
								</p>
								<code className="skills-detail-path">{detail.path}</code>
								<div className="skills-detail-actions">
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
								</div>
							</>
						) : (
							<div className="skills-empty skills-detail-empty">
								<Search size={18} />
								<span>Select a skill to inspect its source and path.</span>
							</div>
						)}
					</aside>
				</div>
			</div>
		</ShapeProvider>
	);
}

function skillKey(skill) {
	return `${skill.source}:${skill.origin}:${skill.name}`;
}

export function initializeSkills() {
	createRoot(document.getElementById("skills")).render(<SkillsApp />);
}
