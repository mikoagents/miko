import { readdir, readFile, statfs } from "node:fs/promises";
import {
	cpus as osCpus,
	freemem as osFreemem,
	loadavg as osLoadavg,
	totalmem as osTotalmem,
	uptime as osUptime,
} from "node:os";
import { resolve } from "node:path";

export interface BoardCpuInfo {
	cores: number;
	loadAverage: [number, number, number];
	/** Approximate utilization from 1-minute load / cores, capped at 100. */
	usagePercent: number;
}

export interface BoardMemoryInfo {
	totalBytes: number;
	usedBytes: number;
	availableBytes: number;
	usedPercent: number;
}

export interface BoardDiskInfo {
	mount: string;
	label: string;
	totalBytes: number;
	usedBytes: number;
	availableBytes: number;
	usedPercent: number;
}

export interface BoardProcessInfo {
	pid: number;
	rssBytes: number;
	heapUsedBytes: number;
}

export interface BoardResourcesInfo {
	collectedAt: string;
	cpu: BoardCpuInfo;
	memory: BoardMemoryInfo;
	disks: BoardDiskInfo[];
	hostUptimeSeconds: number;
	processCount: number | null;
	process: BoardProcessInfo;
}

export interface BoardResourceDeps {
	loadavg?: () => number[];
	cpus?: () => Array<unknown>;
	totalmem?: () => number;
	freemem?: () => number;
	uptime?: () => number;
	memoryUsage?: () => NodeJS.MemoryUsage;
	pid?: number;
	statfs?: (
		path: string,
	) => Promise<{ bsize: number; blocks: number; bfree: number; bavail: number }>;
	readFile?: (path: string, encoding: "utf8") => Promise<string>;
	readdir?: (path: string) => Promise<string[]>;
	now?: () => Date;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function clampPercent(value: number): number {
	if (!Number.isFinite(value) || value < 0) return 0;
	if (value > 100) return 100;
	return round1(value);
}

function bytesFromBlocks(blocks: number, bsize: number): number {
	return Math.max(0, Math.floor(blocks * bsize));
}

export function diskFingerprint(info: {
	bsize: number;
	blocks: number;
	bavail: number;
}): string {
	return `${info.bsize}:${info.blocks}:${info.bavail}`;
}

async function readMemAvailableBytes(
	read: (path: string, encoding: "utf8") => Promise<string>,
): Promise<number | null> {
	try {
		const text = await read("/proc/meminfo", "utf8");
		const match = text.match(/^MemAvailable:\s+(\d+)\s+kB/m);
		if (!match?.[1]) return null;
		return Number.parseInt(match[1], 10) * 1024;
	} catch {
		return null;
	}
}

async function countProcesses(
	listDir: (path: string) => Promise<string[]>,
): Promise<number | null> {
	try {
		const entries = await listDir("/proc");
		let count = 0;
		for (const name of entries) {
			if (/^\d+$/.test(name)) count += 1;
		}
		return count;
	} catch {
		return null;
	}
}

async function collectDisk(
	path: string,
	label: string,
	stat: NonNullable<BoardResourceDeps["statfs"]>,
): Promise<{ disk: BoardDiskInfo; fingerprint: string } | null> {
	try {
		const info = await stat(path);
		const totalBytes = bytesFromBlocks(info.blocks, info.bsize);
		const availableBytes = bytesFromBlocks(info.bavail, info.bsize);
		const freeBytes = bytesFromBlocks(info.bfree, info.bsize);
		const usedBytes = Math.max(0, totalBytes - freeBytes);
		const usedPercent =
			totalBytes > 0 ? clampPercent((usedBytes / totalBytes) * 100) : 0;
		return {
			fingerprint: diskFingerprint(info),
			disk: {
				mount: resolve(path),
				label,
				totalBytes,
				usedBytes,
				availableBytes,
				usedPercent,
			},
		};
	} catch {
		return null;
	}
}

/** Collect host CPU, memory, disk, and process resource usage. */
export async function collectBoardResources(
	options: {
		mikoHome?: string;
		releaseDir?: string;
	} = {},
	deps: BoardResourceDeps = {},
): Promise<BoardResourcesInfo> {
	const loadavg = deps.loadavg ?? osLoadavg;
	const cpus = deps.cpus ?? osCpus;
	const totalmem = deps.totalmem ?? osTotalmem;
	const freemem = deps.freemem ?? osFreemem;
	const uptime = deps.uptime ?? osUptime;
	const memoryUsage = deps.memoryUsage ?? (() => process.memoryUsage());
	const pid = deps.pid ?? process.pid;
	const stat = deps.statfs ?? ((path) => statfs(path));
	const read = deps.readFile ?? ((path, encoding) => readFile(path, encoding));
	const listDir = deps.readdir ?? ((path) => readdir(path));
	const now = deps.now ?? (() => new Date());

	const cores = Math.max(1, cpus().length);
	const loads = loadavg();
	const load1 = loads[0] ?? 0;
	const load5 = loads[1] ?? 0;
	const load15 = loads[2] ?? 0;
	const usagePercent = clampPercent((load1 / cores) * 100);

	const totalBytes = totalmem();
	const freeFallback = freemem();
	const availableBytes =
		(await readMemAvailableBytes(read)) ?? freeFallback;
	const usedBytes = Math.max(0, totalBytes - availableBytes);
	const usedPercent =
		totalBytes > 0 ? clampPercent((usedBytes / totalBytes) * 100) : 0;

	const disks: BoardDiskInfo[] = [];
	const seen = new Set<string>();
	const candidates: Array<{ path: string; label: string }> = [
		{ path: "/", label: "Root" },
	];
	if (options.mikoHome?.trim()) {
		candidates.push({ path: resolve(options.mikoHome), label: "Miko home" });
	}
	if (options.releaseDir?.trim()) {
		candidates.push({
			path: resolve(options.releaseDir),
			label: "Release",
		});
	}
	for (const candidate of candidates) {
		const collected = await collectDisk(candidate.path, candidate.label, stat);
		if (!collected) continue;
		if (seen.has(collected.fingerprint)) continue;
		seen.add(collected.fingerprint);
		disks.push(collected.disk);
	}

	const mem = memoryUsage();
	return {
		collectedAt: now().toISOString(),
		cpu: {
			cores,
			loadAverage: [round1(load1), round1(load5), round1(load15)],
			usagePercent,
		},
		memory: {
			totalBytes,
			usedBytes,
			availableBytes,
			usedPercent,
		},
		disks,
		hostUptimeSeconds: Math.floor(uptime()),
		processCount: await countProcesses(listDir),
		process: {
			pid,
			rssBytes: mem.rss,
			heapUsedBytes: mem.heapUsed,
		},
	};
}
