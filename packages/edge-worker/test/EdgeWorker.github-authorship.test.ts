import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";

const repository = { githubUrl: "https://github.com/example/repo" };
const identity = {
	name: "operator-agent[bot]",
	email: "123456+operator-agent[bot]@users.noreply.github.com",
};
function fixture() {
	const worker = Object.create(EdgeWorker.prototype);
	worker.githubTokenStore = {
		getTokenForRepoUrl: vi.fn(() => "installation-token"),
	};
	worker.githubBotUserIdBySlug = new Map();
	worker.githubBotUserIdRequests = new Map();
	const fetch = vi.fn(
		async () => new Response(JSON.stringify({ id: 123456 }), { status: 200 }),
	);
	vi.stubGlobal("fetch", fetch);
	return { worker, fetch };
}

beforeEach(() => {
	vi.stubEnv("GITHUB_APP_SLUG", "operator-agent");
	vi.stubEnv("GITHUB_APP_ID", "42");
	vi.stubEnv("GITHUB_BOT_USER_ID", undefined);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("GitHub App commit authorship", () => {
	it("uses the fetched bot identity on the first session and caches it", async () => {
		const { worker, fetch } = fixture();
		const auth = await worker.resolveSessionGitHubAuth(repository);
		expect(auth).toEqual({
			token: "installation-token",
			usingAppToken: true,
			gitAuthor: identity,
		});
		expect(await worker.resolveSessionGitHubAuth(repository)).toEqual(auth);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(
			"https://api.github.com/users/operator-agent%5Bbot%5D",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});
	it("shares a lookup between simultaneous session starts", async () => {
		const { worker, fetch } = fixture();
		const auths = await Promise.all([
			worker.resolveSessionGitHubAuth(repository),
			worker.resolveSessionGitHubAuth(repository),
		]);
		expect(auths.map((a) => a.gitAuthor)).toEqual([identity, identity]);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("prefers an explicit numeric bot user id without making a network request", async () => {
		const { worker, fetch } = fixture();
		vi.stubEnv("GITHUB_BOT_USER_ID", "123456");
		expect(
			(await worker.resolveSessionGitHubAuth(repository)).gitAuthor,
		).toEqual(identity);
		expect(fetch).not.toHaveBeenCalled();
	});
	it("ignores an invalid environment id and resolves the bot instead", async () => {
		const { worker, fetch } = fixture();
		vi.stubEnv("GITHUB_BOT_USER_ID", "not-a-user-id");
		expect(
			(await worker.resolveSessionGitHubAuth(repository)).gitAuthor,
		).toEqual(identity);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("keeps the App token and local author on lookup failure, allowing a later retry", async () => {
		const { worker, fetch } = fixture();
		fetch.mockRejectedValueOnce(new Error("Request timed out"));
		expect(await worker.resolveSessionGitHubAuth(repository)).toEqual({
			token: "installation-token",
			usingAppToken: true,
		});
		expect(
			(await worker.resolveSessionGitHubAuth(repository)).gitAuthor,
		).toEqual(identity);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it.each([
		null,
		0,
		-1,
		1.5,
		"invalid",
	])("does not cache invalid API user id %s", async (id) => {
		const { worker, fetch } = fixture();
		fetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ id }), { status: 200 }),
		);
		expect(await worker.resolveSessionGitHubAuth(repository)).toEqual({
			token: "installation-token",
			usingAppToken: true,
		});
		expect(worker.githubBotUserIdBySlug.size).toBe(0);
	});
	it("does not fetch or override authorship on the local credential path", async () => {
		const { worker, fetch } = fixture();
		worker.githubTokenStore.getTokenForRepoUrl.mockReturnValue(undefined);
		expect(await worker.resolveSessionGitHubAuth(repository)).toEqual({
			usingAppToken: false,
		});
		expect(fetch).not.toHaveBeenCalled();
	});
});
