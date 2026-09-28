import { Activity, Check, Copy, FolderOpen, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
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

function StatusApp() {
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
		const timer = setInterval(refresh, 15000);
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
	);
}

export function initializeStatus() {
	createRoot(document.getElementById("status")).render(<StatusApp />);
}
