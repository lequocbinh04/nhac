// Consumer-visible behaviour of the Worker: password gate, sessions, library, covers and streaming.
// Runs inside workerd (see vitest.workers.config.ts) against a local R2 bucket seeded below.
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const ORIGIN = "https://nhac.test";
const PASSWORD = "correct horse battery staple";
const LIBRARY = {
	version: "test000001",
	stats: { tracks: 1, albums: 1, bytes: 1000, seconds: 30 },
	albums: [{ id: "aaaaaaaaaaaa", title: "Mùa Hạ", artist: "Test", year: "2026", genre: "", trackIds: ["bbbbbbbbbbbb"], cover: true }],
	tracks: [],
};
// 1000 bytes where byte i == i % 251, so any slice is easy to verify.
const AUDIO = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
const NESTED_KEY = "Hà Linh/Mùa Hạ #1/01 Nắng? 100%.flac";
const COVER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

let session = "";
let setCookie = "";

// Calls the Worker's fetch handler directly. (`exports.default.fetch` goes through the assets router,
// which in the Vitest plugin answers navigations like "/" with a bare 404 before the Worker runs.)
function get(path: string, init: RequestInit = {}, workerEnv: Env = env): Promise<Response> {
	const request = new Request(ORIGIN + path, init) as Request<unknown, IncomingRequestCfProperties>;
	return worker.fetch(request, workerEnv);
}

function withSession(path: string, init: RequestInit = {}, cookie = session, workerEnv: Env = env): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set("Cookie", `nhac_s=${cookie}`);
	return get(path, { ...init, headers }, workerEnv);
}

function login(password: unknown): Promise<Response> {
	return get("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
}

function streamPath(key: string): string {
	return "/stream/" + key.split("/").map(encodeURIComponent).join("/");
}

async function sign(exp: number): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`session:${exp}`)));
	return `${exp}.${btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

beforeAll(async () => {
	await env.MUSIC.put("_nhac/library.json", JSON.stringify(LIBRARY));
	await env.MUSIC.put("_nhac/covers/aaaaaaaaaaaa.jpg", COVER);
	await env.MUSIC.put("song.flac", AUDIO);
	await env.MUSIC.put(NESTED_KEY, AUDIO);

	const res = await login(PASSWORD);
	expect(res.status).toBe(200);
	setCookie = res.headers.get("Set-Cookie") ?? "";
	session = /^nhac_s=([^;]+)/.exec(setCookie)?.[1] ?? "";
	expect(session).not.toBe("");
});

describe("password gate", () => {
	it("redirects an unauthenticated page request to /login", async () => {
		const res = await get("/");
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(`${ORIGIN}/login`);
	});

	it("keeps a deep link through the login redirect", async () => {
		const res = await get("/track/bbbbbbbbbbbb?t=42");
		expect(res.status).toBe(302);
		const location = new URL(res.headers.get("Location") ?? "");
		expect(location.pathname).toBe("/login");
		expect(location.searchParams.get("next")).toBe("/track/bbbbbbbbbbbb?t=42");
	});

	it("sends a signed-in visitor on to a safe next path only", async () => {
		const cases: [string, string][] = [
			["/track/bbbbbbbbbbbb?t=42", `${ORIGIN}/track/bbbbbbbbbbbb?t=42`],
			["//evil.example/x", `${ORIGIN}/`],
			["/\\evil.example/x", `${ORIGIN}/`],
			["/\t/evil.example/x", `${ORIGIN}/`],
			["https://evil.example/", `${ORIGIN}/`],
			["/login?next=/x", `${ORIGIN}/`],
		];
		for (const [next, expected] of cases) {
			const res = await withSession(`/login?next=${encodeURIComponent(next)}`);
			expect(res.status, next).toBe(302);
			expect(res.headers.get("Location"), next).toBe(expected);
		}
	});

	it("answers unauthenticated API, stream and cover requests with 401 JSON", async () => {
		for (const path of ["/api/library", "/stream/song.flac", "/cover/aaaaaaaaaaaa.jpg", "/lyrics/bbbbbbbbbbbb"]) {
			const res = await get(path);
			expect(res.status, path).toBe(401);
			expect(res.headers.get("Content-Type")).toContain("application/json");
			expect(await res.json()).toEqual({ error: "unauthorized" });
		}
	});

	it("rejects a wrong password with 401 wrong_password and no cookie", async () => {
		const res = await login("hunter2");
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "wrong_password" });
		expect(res.headers.get("Set-Cookie")).toBeNull();
	});

	it("rejects a malformed body with 400 bad_request", async () => {
		const res = await get("/api/login", { method: "POST", body: "{not json" });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "bad_request" });
	});

	it("sets an HttpOnly Secure session cookie on the correct password", async () => {
		// beforeAll logged in with the right password; check what the browser was told to store.
		const attributes = setCookie.split(/;\s*/).slice(1).map((a) => a.toLowerCase());
		expect(attributes).toEqual(expect.arrayContaining(["httponly", "secure", "samesite=lax", "path=/", `max-age=${180 * 86400}`]));
		const exp = Number(session.split(".")[0]);
		expect(exp).toBeGreaterThan(Date.now() / 1000 + 179 * 86400);
	});

	it("returns _nhac/library.json to a signed-in client", async () => {
		const res = await withSession("/api/library");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("application/json");
		expect(await res.json()).toEqual(LIBRARY);
	});

	it("sends a signed-in visitor from /login to /", async () => {
		const res = await withSession("/login");
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(`${ORIGIN}/`);
	});

	it("rejects tampered and expired cookies", async () => {
		const [exp, sig] = session.split(".");
		const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
		const expired = await sign(Math.floor(Date.now() / 1000) - 60);
		for (const cookie of [`${exp}.${flipped}`, `${Number(exp) + 1}.${sig}`, expired, "garbage", `${exp}.`]) {
			const res = await withSession("/api/library", {}, cookie);
			expect(res.status, cookie).toBe(401);
			expect(await res.json()).toEqual({ error: "unauthorized" });
		}
		// Control: the forged-but-valid signature format is accepted when not expired.
		expect((await withSession("/api/library", {}, await sign(Math.floor(Date.now() / 1000) + 60))).status).toBe(200);
	});

	it("clears the cookie on logout", async () => {
		const res = await withSession("/api/logout", { method: "POST" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		const cookie = res.headers.get("Set-Cookie") ?? "";
		expect(cookie).toMatch(/^nhac_s=;/);
		expect(cookie).toContain("Max-Age=0");
		expect(cookie).toContain("Path=/");
	});
});

describe("streaming", () => {
	it("serves a whole file with 200 and Accept-Ranges", async () => {
		const res = await withSession("/stream/song.flac");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("audio/flac");
		expect(res.headers.get("Accept-Ranges")).toBe("bytes");
		expect(res.headers.get("Content-Length")).toBe("1000");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(AUDIO);
	});

	it.each([
		["bytes=100-199", 100, 199],
		["bytes=900-", 900, 999],
		["bytes=-50", 950, 999],
		["bytes=990-5000", 990, 999],
	])("answers Range %s with 206 and the exact bytes", async (range, start, end) => {
		const res = await withSession("/stream/song.flac", { headers: { Range: range } });
		expect(res.status).toBe(206);
		expect(res.headers.get("Content-Range")).toBe(`bytes ${start}-${end}/1000`);
		expect(res.headers.get("Content-Length")).toBe(String(end - start + 1));
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(AUDIO.slice(start, end + 1));
	});

	it("streams a nested key whose segments are percent-encoded", async () => {
		const res = await withSession(streamPath(NESTED_KEY), { headers: { Range: "bytes=0-9" } });
		expect(res.status).toBe(206);
		expect(res.headers.get("Content-Range")).toBe("bytes 0-9/1000");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(AUDIO.slice(0, 10));
	});

	it("answers If-None-Match with 304", async () => {
		const etag = (await withSession("/stream/song.flac")).headers.get("ETag") ?? "";
		expect(etag).not.toBe("");
		const res = await withSession("/stream/song.flac", { headers: { "If-None-Match": etag } });
		expect(res.status).toBe(304);
	});

	it("returns 404 for missing tracks", async () => {
		expect((await withSession("/stream/missing.flac")).status).toBe(404);
	});

	it("never serves the library folder or dot segments through /stream", async () => {
		for (const path of [
			"/stream/_nhac/library.json",
			"/stream/_nhac%2Flibrary.json",
			"/stream/_nhac/covers/aaaaaaaaaaaa.jpg",
			// URL parsing folds these back to /stream/_nhac/library.json before the Worker sees them.
			"/stream/x/../_nhac/library.json",
			"/stream/x/%2E%2E/_nhac/library.json",
			// Encoded slashes keep ".." inside one segment; the decoded key must still be refused.
			"/stream/x%2F..%2F_nhac%2Flibrary.json",
			"/stream/..%2F_nhac%2Flibrary.json",
			"/stream/song.flac/",
			"/stream//song.flac",
			"/stream/%E0%A4%A",
		]) {
			const res = await withSession(path);
			expect(res.status, path).toBe(404);
			await res.body?.cancel();
		}
	});
});

describe("covers", () => {
	it("serves a cover by album id", async () => {
		const res = await withSession("/cover/aaaaaaaaaaaa.jpg");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/jpeg");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(COVER);
	});

	it("returns 404 for invalid or unknown cover ids", async () => {
		for (const path of ["/cover/AAAAAAAAAAAA.jpg", "/cover/aaaa.jpg", "/cover/..%2Flibrary.json", "/cover/aaaaaaaaaaaa.png", "/cover/cccccccccccc.jpg"]) {
			const res = await withSession(path);
			expect(res.status, path).toBe(404);
			await res.body?.cancel();
		}
	});
});

describe("lyrics", () => {
	const LRC = "[00:01.00]Dòng một\n[00:04.50]Dòng hai\n";
	beforeAll(async () => {
		await env.MUSIC.put("_nhac/lyrics/bbbbbbbbbbbb.lrc", LRC);
	});

	it("serves a track's lyrics as UTF-8 text", async () => {
		const res = await withSession("/lyrics/bbbbbbbbbbbb");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
		expect(await res.text()).toBe(LRC);
	});

	it("404s for missing lyrics and malformed ids", async () => {
		for (const path of ["/lyrics/cccccccccccc", "/lyrics/bbbbbbbbbbbb.lrc", "/lyrics/..%2Flibrary", "/lyrics/"]) {
			expect((await withSession(path)).status, path).toBe(404);
		}
	});
});

describe("S3 mode", () => {
	const s3Env = { ...env, STORAGE: "s3", S3_ENDPOINT: "https://s3.example.com/", S3_BUCKET: "music", S3_REGION: "auto", S3_ACCESS_KEY_ID: "AKID", S3_SECRET_ACCESS_KEY: "secret" } as Env;
	const upstream: Request[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		upstream.length = 0;
	});

	function mockS3() {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const req = new Request(input, init);
			upstream.push(req);
			return new Response(AUDIO.slice(0, 10), {
				status: 206,
				headers: { "Content-Range": "bytes 0-9/1000", "Content-Length": "10", ETag: '"abc"', "x-amz-request-id": "hidden" },
			});
		});
	}

	it("signs a path-style request inside the bucket and forwards Range", async () => {
		mockS3();
		const res = await withSession(streamPath(NESTED_KEY), { headers: { Range: "bytes=0-9" } }, session, s3Env);
		expect(res.status).toBe(206);
		expect(res.headers.get("Content-Range")).toBe("bytes 0-9/1000");
		expect(res.headers.get("Content-Type")).toBe("audio/flac");
		expect(res.headers.get("x-amz-request-id")).toBeNull();
		expect(upstream).toHaveLength(1);
		const sent = upstream[0];
		expect(new URL(sent.url).pathname).toBe("/music/" + NESTED_KEY.split("/").map(encodeURIComponent).join("/"));
		expect(sent.headers.get("Range")).toBe("bytes=0-9");
		expect(sent.headers.get("Authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
	});

	it("never lets an encoded '..' escape the bucket", async () => {
		mockS3();
		for (const path of ["/stream/x%2F..%2F_nhac%2Flibrary.json", "/stream/..%2Fother-bucket%2Fsecret.flac"]) {
			const res = await withSession(path, {}, session, s3Env);
			await res.body?.cancel();
			for (const req of upstream) {
				const p = new URL(req.url).pathname;
				expect(p, path).toMatch(/^\/music\//);
				expect(p, path).not.toMatch(/^\/music\/_nhac\//);
			}
		}
	});
});

// Keep last: every login attempt above counts against the shared LOGIN_LIMITER key.
describe("login rate limit", () => {
	it("returns 429 rate_limited once the limit (8/min) is exhausted", async () => {
		const statuses: number[] = [];
		for (let i = 0; i < 12; i++) {
			const res = await login("wrong");
			statuses.push(res.status);
			if (res.status === 429) expect(await res.json()).toEqual({ error: "rate_limited" });
			else await res.body?.cancel();
		}
		const first = statuses.indexOf(429);
		expect(first, statuses.join(",")).toBeGreaterThanOrEqual(0);
		expect(statuses.slice(first).every((s) => s === 429)).toBe(true);
		// Even the right password is refused while limited.
		expect((await login(PASSWORD)).status).toBe(429);
	});
});
