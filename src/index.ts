// nhac: self-hosted lossless music player. Password gate + bucket streaming + static UI.
import { serveObject } from "./storage";

const COOKIE = "nhac_s";
const SESSION_DAYS = 180;
// Reachable without a session: the login page and the assets it needs.
const PUBLIC_PATHS: Record<string, true> = { "/login": true, "/login.html": true, "/favicon.svg": true, "/manifest.webmanifest": true };
const PUBLIC_PREFIX = "/assets/";

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
	let s = "";
	for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<ArrayBuffer> {
	const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return crypto.subtle.sign("HMAC", key, enc.encode(data));
}

// Constant-time comparison of two arbitrary strings: compare their HMACs, which have equal length.
async function secretEquals(secret: string, a: string, b: string): Promise<boolean> {
	const [ha, hb] = await Promise.all([hmac(secret, a), hmac(secret, b)]);
	return crypto.subtle.timingSafeEqual(ha, hb);
}

async function sessionSignature(env: Env, exp: number): Promise<string> {
	return b64url(await hmac(env.SESSION_SECRET, `session:${exp}`));
}

async function validSession(env: Env, request: Request): Promise<boolean> {
	const cookie = request.headers.get("Cookie") ?? "";
	const value = cookie.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
	if (!value) return false;
	const [expStr, sig] = value.split(".");
	const exp = Number(expStr);
	if (!sig || !Number.isInteger(exp) || exp < Date.now() / 1000) return false;
	return secretEquals(env.SESSION_SECRET, sig, await sessionSignature(env, exp));
}

function sessionCookie(value: string, maxAge: number): string {
	return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
	});
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
	const { success } = await env.LOGIN_LIMITER.limit({ key: "login" });
	if (!success) return json({ error: "rate_limited" }, 429);
	let password = "";
	try {
		const body: unknown = await request.json();
		if (body && typeof body === "object" && "password" in body && typeof body.password === "string") password = body.password;
	} catch {
		return json({ error: "bad_request" }, 400);
	}
	if (!password || !(await secretEquals(env.SESSION_SECRET, password, env.APP_PASSWORD))) {
		return json({ error: "wrong_password" }, 401);
	}
	const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
	return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(`${exp}.${await sessionSignature(env, exp)}`, SESSION_DAYS * 86400) });
}

// "/stream/Artist/Album/01%20Song.flac" -> "Artist/Album/01 Song.flac"; null for anything unsafe.
function trackKey(path: string, libraryPrefix: string): string | null {
	try {
		// Validate after decoding: an encoded "%2F..%2F" must not smuggle a traversal segment.
		const key = path.slice("/stream/".length).split("/").map((s) => decodeURIComponent(s)).join("/");
		if (key.split("/").some((s) => s === "" || s === "." || s === "..")) return null;
		return key.startsWith(libraryPrefix) ? null : key;
	} catch {
		return null;
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const isRead = request.method === "GET" || request.method === "HEAD";

		if (path === "/api/login" && request.method === "POST") return handleLogin(request, env);
		if (PUBLIC_PATHS[path] || path.startsWith(PUBLIC_PREFIX)) {
			if (path === "/login" && (await validSession(env, request))) return Response.redirect(new URL("/", url).toString(), 302);
			// The assets layer serves login.html at /login itself (and redirects /login.html -> /login).
			return env.ASSETS.fetch(request);
		}

		if (!(await validSession(env, request))) {
			if (path.startsWith("/api/") || path.startsWith("/stream/") || path.startsWith("/cover/")) {
				return json({ error: "unauthorized" }, 401);
			}
			return Response.redirect(new URL("/login", url).toString(), 302);
		}

		if (path === "/api/logout" && request.method === "POST") {
			return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
		}
		if (path === "/api/library" && isRead) {
			return serveObject(request, env, `${env.LIBRARY_PREFIX}library.json`, "private, no-cache");
		}
		if (path.startsWith("/cover/") && isRead) {
			const file = path.slice("/cover/".length);
			if (!/^[0-9a-f]{12}\.jpg$/.test(file)) return new Response("Not found", { status: 404 });
			return serveObject(request, env, `${env.LIBRARY_PREFIX}covers/${file}`, "private, max-age=2592000");
		}
		if (path.startsWith("/stream/") && isRead) {
			const key = trackKey(path, env.LIBRARY_PREFIX);
			if (!key) return new Response("Not found", { status: 404 });
			return serveObject(request, env, key, "private, max-age=86400");
		}
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
