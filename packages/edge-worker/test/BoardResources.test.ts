import { describe, expect, it } from "vitest";
import {
	collectBoardResources,
	diskFingerprint,
} from "../src/BoardResources.js";

describe("BoardResources", () => {
	it("collects cpu, memory, disks, and process stats from injected deps", async () => {
		const resources = await collectBoardResources(
			{
				mikoHome: "/home/box/.miko",
				releaseDir: "/home/box/.local/share/miko",
			},
			{
				loadavg: () => [1.6, 0.8, 0.4],
				cpus: () => Array.from({ length: 4 }),
				totalmem: () => 8 * 1024 ** 3,
				freemem: () => 2 * 1024 ** 3,
				uptime: () => 3661.7,
				memoryUsage: () =>
					({
						rss: 50 * 1024 ** 2,
						heapTotal: 20 * 1024 ** 2,
						heapUsed: 12 * 1024 ** 2,
						external: 0,
						arrayBuffers: 0,
					}) as NodeJS.MemoryUsage,
				pid: 4242,
				now: () => new Date("2026-09-28T10:00:00.000Z"),
				readFile: async () =>
					"MemTotal:        8388608 kB\nMemAvailable:    3145728 kB\n",
				readdir: async () => ["1", "2", "self", "cpuinfo", "42"],
				statfs: async (path: string) => {
					if (path === "/") {
						return {
							bsize: 4096,
							blocks: 1_000_000,
							bfree: 400_000,
							bavail: 350_000,
						};
					}
					// Distinct filesystem for miko home
					return {
						bsize: 4096,
						blocks: 500_000,
						bfree: 200_000,
						bavail: 180_000,
					};
				},
			},
		);

		expect(resources.collectedAt).toBe("2026-09-28T10:00:00.000Z");
		expect(resources.cpu).toEqual({
			cores: 4,
			loadAverage: [1.6, 0.8, 0.4],
			usagePercent: 40,
		});
		expect(resources.memory.totalBytes).toBe(8 * 1024 ** 3);
		expect(resources.memory.availableBytes).toBe(3145728 * 1024);
		expect(resources.memory.usedBytes).toBe(8 * 1024 ** 3 - 3145728 * 1024);
		expect(resources.memory.usedPercent).toBeGreaterThan(0);
		expect(resources.disks).toHaveLength(2);
		expect(resources.disks[0]).toMatchObject({
			label: "Root",
			mount: "/",
			usedPercent: 60,
		});
		expect(resources.disks[1]?.label).toBe("Miko home");
		expect(resources.hostUptimeSeconds).toBe(3661);
		expect(resources.processCount).toBe(3);
		expect(resources.process).toEqual({
			pid: 4242,
			rssBytes: 50 * 1024 ** 2,
			heapUsedBytes: 12 * 1024 ** 2,
		});
	});

	it("dedupes disks that share the same filesystem fingerprint", async () => {
		const sameFs = {
			bsize: 4096,
			blocks: 100,
			bfree: 40,
			bavail: 30,
		};
		const resources = await collectBoardResources(
			{ mikoHome: "/data/miko", releaseDir: "/data/miko/release" },
			{
				loadavg: () => [0, 0, 0],
				cpus: () => [{}],
				totalmem: () => 1024,
				freemem: () => 512,
				uptime: () => 10,
				statfs: async () => sameFs,
				readFile: async () => {
					throw new Error("no proc");
				},
				readdir: async () => {
					throw new Error("no proc");
				},
			},
		);
		expect(resources.disks).toHaveLength(1);
		expect(resources.disks[0]?.label).toBe("Root");
		expect(resources.processCount).toBeNull();
		expect(diskFingerprint(sameFs)).toBe("4096:100:30");
	});

	it("caps cpu usage percent at 100 when load exceeds cores", async () => {
		const resources = await collectBoardResources(
			{},
			{
				loadavg: () => [8, 4, 2],
				cpus: () => [{}, {}],
				totalmem: () => 1000,
				freemem: () => 500,
				uptime: () => 1,
				statfs: async () => ({
					bsize: 1024,
					blocks: 10,
					bfree: 5,
					bavail: 4,
				}),
				readFile: async () => {
					throw new Error("no proc");
				},
				readdir: async () => [],
			},
		);
		expect(resources.cpu.usagePercent).toBe(100);
		expect(resources.cpu.cores).toBe(2);
	});
});
