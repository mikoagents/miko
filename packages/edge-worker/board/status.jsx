import {
	Activity,
	Boxes,
	Check,
	Copy,
	Cpu,
	FolderOpen,
	GitBranch,
	HardDrive,
	MemoryStick,
	RefreshCw,
	Settings2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "./fluid/components/ui/badge";
import { Button } from "./fluid/components/ui/button";
import { ShapeProvider } from "./fluid/lib/shape-context";
import "./fluid/theme.css";
import "./status.css";

function formatUptime(seconds) {
	const total = Math.max(0, Math.floor(seconds || 0));
	const days = Math.floor(total / 86400);
	const hours = Math.floor((total % 86400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	if (days) return `${days}d ${hours}h ${minutes}m`;
	if (hours) return `${hours}h ${minutes}m`;
	if (minutes) return `${minutes}m ${secs}s`;
	return `${secs}s`;
}

function formatBytes(bytes) {
	const value = Math.max(0, Number(bytes) || 0);
	const units = ["B", "KB", "MB", "GB", "TB"];
	let size = value;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit += 1;
	}
	const digits = size >= 100 || unit === 0 ? 0 : size >= 10 ? 1 : 2;
	return `${size.toFixed(digits)} ${units[unit]}`;
}

function formatLoad(loadAverage) {
	return (loadAverage || []).map((n) => Number(n).toFixed(2)).join(" / ");
}

function repoDisplayName(repo) {
	const url = repo.githubUrl || repo.gitlabUrl || "";
	const match = url.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
	if (match) return `${match[1]}/${match[2]}`;
	return repo.name;
}

function defaultRows(defaults) {
	if (!defaults) return [];
	return [
		["Default runner", defaults.defaultRunner],
		["Claude model", defaults.claudeDefaultModel],
		["Claude fallback", defaults.claudeDefaultFallbackModel],
		["Cursor model", defaults.cursorDefaultModel],
		["Cursor fallback", defaults.cursorDefaultFallbackModel],
		["Grok model", defaults.grokDefaultModel],
		["Grok fallback", defaults.grokDefaultFallbackModel],
	].filter(([, value]) => value);
}

function ResourceBar({ percent, label }) {
	const width = Math.max(0, Math.min(100, Number(percent) || 0));
	const tone = width >= 90 ? "critical" : width >= 75 ? "warn" : "ok";
	return (
		<meter
			className={`status-resource-bar status-resource-bar-${tone}`}
			aria-label={label}
			min={0}
			max={100}
			value={width}
		/>
	);
}

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

export function StatusPage() {
	const [data, setData] = useState(null);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState("");
	const [copied, setCopied] = useState("");
	const [message, setMessage] = useState("");

	const reload = useCallback(async (signal) => {
		const response = await fetch("/board/api/status", {
			cache: "no-store",
			signal,
		});
		if (!response.ok) throw new Error("Cannot load status");
		return response.json();
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		const refresh = () =>
			reload(controller.signal)
				.then((next) => {
					if (!controller.signal.aborted) {
						setData(next);
						setError("");
						setLoading(false);
					}
				})
				.catch((err) => {
					if (!controller.signal.aborted) {
						setError(err.message || "Cannot load status");
						setLoading(false);
					}
				});
		void refresh();
		const timer = setInterval(refresh, 8000);
		return () => {
			controller.abort();
			clearInterval(timer);
		};
	}, [reload]);

	async function openDirectory(id) {
		setBusy(id);
		setMessage("");
		try {
			const response = await fetch("/board/api/open-directory", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id }),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error || "Cannot open directory");
			setMessage(
				body.opened
					? `Opened ${body.path}`
					: `Path ready to copy: ${body.path}`,
			);
			if (!body.opened) {
				await copyText(body.path);
				setCopied(id);
				setTimeout(() => setCopied(""), 1500);
			}
		} catch (err) {
			setMessage(err.message || "Cannot open directory");
		} finally {
			setBusy("");
		}
	}

	async function copyPath(id, path) {
		const ok = await copyText(path);
		setCopied(ok ? id : "");
		setMessage(ok ? `Copied ${path}` : "Could not copy path");
		if (ok) setTimeout(() => setCopied(""), 1500);
	}

	return (
		<section className="status-page" aria-label="Status">
			<ShapeProvider defaultShape="rounded">
				<div className="fluid-scope status-canvas">
					<header className="status-header">
						<div>
							<h1>Status</h1>
							<p className="status-subtitle">
								Runtime details and shortcuts into Miko directories on this
								machine.
							</p>
						</div>
						<Button
							variant="ghost"
							leadingIcon={RefreshCw}
							onClick={() => {
								setLoading(true);
								reload()
									.then((next) => {
										setData(next);
										setError("");
									})
									.catch((err) => setError(err.message || "Cannot load status"))
									.finally(() => setLoading(false));
							}}
						>
							Refresh
						</Button>
					</header>
					{error && (
						<div className="status-banner status-banner-error" role="alert">
							{error}
						</div>
					)}
					{message && !error && (
						<div className="status-banner" role="status">
							{message}
						</div>
					)}
					{loading && !data ? (
						<div className="status-empty">Loading status…</div>
					) : data ? (
						<>
							<section className="status-metrics" aria-label="Runtime">
								<article className="status-card">
									<span>Version</span>
									<strong>{data.version || "Unknown"}</strong>
								</article>
								<article className="status-card">
									<span>Service</span>
									<strong className="status-service">
										<Badge
											variant="dot"
											color={data.service?.status === "busy" ? "blue" : "green"}
											size="compact"
										>
											{data.service?.status === "busy" ? "Busy" : "Idle"}
										</Badge>
									</strong>
								</article>
								<article className="status-card">
									<span>Uptime</span>
									<strong>{formatUptime(data.uptimeSeconds)}</strong>
								</article>
								<article className="status-card">
									<span>Automations</span>
									<strong>
										{typeof data.automationCount === "number"
											? data.automationCount
											: "—"}
									</strong>
								</article>
								<article className="status-card">
									<span>Process</span>
									<strong>
										pid {data.pid} · {data.platform} · {data.nodeVersion}
									</strong>
								</article>
								<article className="status-card">
									<span>Working directory</span>
									<strong className="status-mono">{data.cwd}</strong>
								</article>
							</section>

							<section
								className="status-resources"
								aria-label="System resources"
							>
								<div className="status-section-title">
									<Cpu size={16} />
									<span>System resources</span>
								</div>
								<div className="status-resource-grid">
									<article className="status-resource-card">
										<div className="status-resource-heading">
											<Cpu size={15} />
											<strong>CPU</strong>
											<span>{data.resources?.cpu?.cores ?? "—"} cores</span>
										</div>
										<div className="status-resource-metric">
											<span>Load (1 / 5 / 15)</span>
											<strong>
												{formatLoad(data.resources?.cpu?.loadAverage)}
											</strong>
										</div>
										<div className="status-resource-metric">
											<span>Approx. usage</span>
											<strong>
												{typeof data.resources?.cpu?.usagePercent === "number"
													? `${data.resources.cpu.usagePercent}%`
													: "—"}
											</strong>
										</div>
										<ResourceBar
											percent={data.resources?.cpu?.usagePercent}
											label="CPU usage"
										/>
									</article>
									<article className="status-resource-card">
										<div className="status-resource-heading">
											<MemoryStick size={15} />
											<strong>Memory</strong>
											<span>
												{typeof data.resources?.memory?.usedPercent === "number"
													? `${data.resources.memory.usedPercent}%`
													: "—"}
											</span>
										</div>
										<div className="status-resource-metric">
											<span>Used / total</span>
											<strong>
												{data.resources?.memory
													? `${formatBytes(data.resources.memory.usedBytes)} / ${formatBytes(data.resources.memory.totalBytes)}`
													: "—"}
											</strong>
										</div>
										<div className="status-resource-metric">
											<span>Available</span>
											<strong>
												{data.resources?.memory
													? formatBytes(data.resources.memory.availableBytes)
													: "—"}
											</strong>
										</div>
										<ResourceBar
											percent={data.resources?.memory?.usedPercent}
											label="Memory usage"
										/>
									</article>
									{(data.resources?.disks || []).map((disk) => (
										<article
											key={`${disk.label}:${disk.mount}`}
											className="status-resource-card"
										>
											<div className="status-resource-heading">
												<HardDrive size={15} />
												<strong>{disk.label}</strong>
												<span>{disk.usedPercent}%</span>
											</div>
											<div className="status-resource-metric">
												<span>Used / total</span>
												<strong>
													{formatBytes(disk.usedBytes)} /{" "}
													{formatBytes(disk.totalBytes)}
												</strong>
											</div>
											<div className="status-resource-metric">
												<span>Available</span>
												<strong>{formatBytes(disk.availableBytes)}</strong>
											</div>
											<code className="status-resource-path">{disk.mount}</code>
											<ResourceBar
												percent={disk.usedPercent}
												label={`${disk.label} disk`}
											/>
										</article>
									))}
								</div>
							</section>

							<section className="status-host" aria-label="Host and process">
								<div className="status-section-title">
									<Activity size={16} />
									<span>Host & process</span>
								</div>
								<div className="status-host-grid">
									<article className="status-card">
										<span>Host uptime</span>
										<strong>
											{typeof data.resources?.hostUptimeSeconds === "number"
												? formatUptime(data.resources.hostUptimeSeconds)
												: "—"}
										</strong>
									</article>
									<article className="status-card">
										<span>Processes</span>
										<strong>
											{typeof data.resources?.processCount === "number"
												? data.resources.processCount
												: "—"}
										</strong>
									</article>
									<article className="status-card">
										<span>Miko RSS</span>
										<strong>
											{data.resources?.process
												? formatBytes(data.resources.process.rssBytes)
												: "—"}
										</strong>
									</article>
									<article className="status-card">
										<span>Heap used</span>
										<strong>
											{data.resources?.process
												? formatBytes(data.resources.process.heapUsedBytes)
												: "—"}
										</strong>
									</article>
								</div>
							</section>

							<section className="status-config" aria-label="Configuration">
								<div className="status-section-title">
									<Settings2 size={16} />
									<span>Configuration</span>
								</div>
								<div className="status-config-grid">
									<article className="status-config-card">
										<div className="status-config-heading">
											<strong>Defaults</strong>
											<span>Runner & models</span>
										</div>
										{defaultRows(data.defaults).length ? (
											<dl className="status-config-list">
												{defaultRows(data.defaults).map(([label, value]) => (
													<div key={label}>
														<dt>{label}</dt>
														<dd>{value}</dd>
													</div>
												))}
											</dl>
										) : (
											<p className="status-config-empty">
												No defaults configured.
											</p>
										)}
									</article>
									<article className="status-config-card">
										<div className="status-config-heading">
											<strong>Workspaces</strong>
											<span>{(data.workspaces || []).length}</span>
										</div>
										{(data.workspaces || []).length ? (
											<ul className="status-workspace-list">
												{(data.workspaces || []).map((workspace) => (
													<li key={workspace.id}>
														<div className="status-workspace-copy">
															<strong>
																{workspace.name ||
																	workspace.slug ||
																	workspace.id}
															</strong>
															{workspace.slug && <code>{workspace.slug}</code>}
														</div>
														<div className="status-workspace-badges">
															{workspace.tokenConfigured && (
																<Badge
																	variant="dot"
																	color="green"
																	size="compact"
																>
																	Token configured
																</Badge>
															)}
															{workspace.oauthConfigured && (
																<Badge
																	variant="dot"
																	color="blue"
																	size="compact"
																>
																	OAuth configured
																</Badge>
															)}
															{!workspace.tokenConfigured &&
																!workspace.oauthConfigured && (
																	<Badge
																		variant="dot"
																		color="gray"
																		size="compact"
																	>
																		No credentials
																	</Badge>
																)}
														</div>
													</li>
												))}
											</ul>
										) : (
											<p className="status-config-empty">
												No Linear workspaces.
											</p>
										)}
									</article>
								</div>
							</section>

							<section
								className="status-repositories"
								aria-label="Repositories"
							>
								<div className="status-section-title">
									<Boxes size={16} />
									<span>Repositories</span>
									<span className="status-section-count">
										{(data.repositories || []).length}
									</span>
								</div>
								{(data.repositories || []).length ? (
									<div className="status-repo-grid">
										{(data.repositories || []).map((repo) => (
											<article key={repo.id} className="status-repo">
												<div className="status-repo-copy">
													<div className="status-repo-heading">
														<strong title={repo.name}>
															{repoDisplayName(repo)}
														</strong>
														{repo.isActive ? (
															<Badge variant="dot" color="green" size="compact">
																Active
															</Badge>
														) : (
															<Badge variant="dot" color="gray" size="compact">
																Inactive
															</Badge>
														)}
														{repo.checkoutExists ? (
															<Badge variant="dot" color="blue" size="compact">
																Checked out
															</Badge>
														) : (
															<Badge
																variant="dot"
																color="orange"
																size="compact"
															>
																Missing checkout
															</Badge>
														)}
													</div>
													{(repo.githubUrl || repo.gitlabUrl) && (
														<a
															className="status-repo-link"
															href={repo.githubUrl || repo.gitlabUrl}
															target="_blank"
															rel="noreferrer"
														>
															{repo.githubUrl || repo.gitlabUrl}
														</a>
													)}
													<div className="status-repo-meta">
														<span>
															<GitBranch size={12} />
															{repo.baseBranch || "—"}
														</span>
														{(repo.linearWorkspaceName ||
															repo.linearWorkspaceSlug) && (
															<span>
																Workspace{" "}
																{repo.linearWorkspaceName ||
																	repo.linearWorkspaceSlug}
																{repo.linearWorkspaceSlug
																	? ` (${repo.linearWorkspaceSlug})`
																	: ""}
															</span>
														)}
													</div>
													<code title={repo.repositoryPath}>
														{repo.repositoryPath}
													</code>
												</div>
											</article>
										))}
									</div>
								) : (
									<div className="status-empty">
										No repositories configured.
									</div>
								)}
							</section>

							<section className="status-directories" aria-label="Directories">
								<div className="status-section-title">
									<FolderOpen size={16} />
									<span>Directories</span>
								</div>
								<div className="status-directory-list">
									{(data.directories || []).map((directory) => (
										<article key={directory.id} className="status-directory">
											<div className="status-directory-copy">
												<div className="status-directory-heading">
													<strong>{directory.label}</strong>
													{directory.exists ? (
														<Badge variant="dot" color="green" size="compact">
															Present
														</Badge>
													) : (
														<Badge variant="dot" color="gray" size="compact">
															Missing
														</Badge>
													)}
												</div>
												<p>{directory.description}</p>
												<code>{directory.path}</code>
											</div>
											<div className="status-directory-actions">
												<Button
													variant="ghost"
													size="compact"
													leadingIcon={copied === directory.id ? Check : Copy}
													onClick={() => copyPath(directory.id, directory.path)}
												>
													{copied === directory.id ? "Copied" : "Copy"}
												</Button>
												<Button
													variant="secondary"
													size="compact"
													leadingIcon={FolderOpen}
													loading={busy === directory.id}
													disabled={!directory.exists || busy === directory.id}
													onClick={() => openDirectory(directory.id)}
												>
													Open
												</Button>
											</div>
										</article>
									))}
								</div>
							</section>
							<footer className="status-footer">
								<Activity size={13} />
								<span>
									Open uses the OS file manager when available. Paths stay
									copyable on headless hosts.
								</span>
							</footer>
						</>
					) : null}
				</div>
			</ShapeProvider>
		</section>
	);
}
