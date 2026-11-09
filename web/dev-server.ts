// Local dev mode: serve a real library from disk without wrangler or a bucket.
//
//   NHAC_MUSIC_DIR=/path/to/Music npm run dev:web
//
// When NHAC_MUSIC_DIR is set this Vite plugin answers, before the proxy to `wrangler dev`:
//   GET  /api/library     -> ${NHAC_LIBRARY_DIR:-library-data}/library.json
//   GET  /cover/<id>.jpg  -> ${NHAC_LIBRARY_DIR:-library-data}/covers/<id>.jpg
//   GET  /stream/<key>    -> ${NHAC_MUSIC_DIR}/<key> with Range (206), HEAD, content types
//   POST /api/logout      -> { ok: true }
//   POST /api/login       -> { ok: true } (so the login page also works locally)
// There is no password gate in this mode. NHAC_LIBRARY_DIR is resolved from the current working
// directory (the repo root under npm). Without NHAC_MUSIC_DIR, nothing changes: /api, /stream and
// /cover are proxied to wrangler as configured in vite.config.ts.
import { createReadStream, promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { Plugin } from "vite";

const AUDIO_TYPES: Record<string, string> = {
	".flac": "audio/flac",
	".m4a": "audio/mp4",
	".mp4": "audio/mp4",
	".alac": "audio/mp4",
	".wav": "audio/wav",
	".aif": "audio/aiff",
	".aiff": "audio/aiff",
	".mp3": "audio/mpeg",
	".aac": "audio/aac",
	".ogg": "audio/ogg",
	".oga": "audio/ogg",
	".opus": "audio/ogg",
	".wv": "audio/x-wavpack",
};

function send(res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8") {
	res.statusCode = status;
	res.setHeader("Content-Type", type);
	res.setHeader("Cache-Control", "no-store");
	res.end(body);
}

/** "/stream/A/B%20C.flac" -> "A/B C.flac"; null when a segment is empty, "." or "..". */
export function streamKey(pathname: string): string | null {
	try {
		const parts = pathname.slice("/stream/".length).split("/").map(decodeURIComponent);
		if (parts.some((p) => p === "" || p === "." || p === ".." || p.includes("\0"))) return null;
		return parts.join("/");
	} catch {
		return null;
	}
}

export type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

/** Parse a single "bytes=" range against a file size. Null when absent or not a byte range. */
export function parseRange(header: string | undefined, size: number): ByteRange {
	if (!header) return null;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m) return null;
	const [, a, b] = m;
	if (a === "" && b === "") return null;
	let start: number;
	let end: number;
	if (a === "") {
		const suffix = Number(b);
		if (suffix === 0) return "unsatisfiable";
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(a);
		end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
	}
	if (start >= size || start > end) return "unsatisfiable";
	return { start, end };
}

async function serveFile(req: IncomingMessage, res: ServerResponse, file: string, type: string, cache: string) {
	let stat;
	try {
		stat = await fs.stat(file);
	} catch {
		return send(res, 404, "Not found");
	}
	if (!stat.isFile()) return send(res, 404, "Not found");
	const size = stat.size;
	res.setHeader("Content-Type", type);
	res.setHeader("Accept-Ranges", "bytes");
	res.setHeader("Cache-Control", cache);
	res.setHeader("Last-Modified", stat.mtime.toUTCString());
	const range = parseRange(req.headers.range, size);
	if (range === "unsatisfiable") {
		res.statusCode = 416;
		res.setHeader("Content-Range", `bytes */${size}`);
		return res.end();
	}
	const start = range ? range.start : 0;
	const end = range ? range.end : size - 1;
	res.statusCode = range ? 206 : 200;
	res.setHeader("Content-Length", String(size === 0 ? 0 : end - start + 1));
	if (range) res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
	if (req.method === "HEAD" || size === 0) return res.end();
	const stream = createReadStream(file, { start, end });
	stream.on("error", () => res.destroy());
	res.on("close", () => stream.destroy());
	stream.pipe(res);
}

export function nhacDevServer(): Plugin {
	return {
		name: "nhac-dev-server",
		apply: "serve",
		configureServer(server) {
			const musicDir = process.env.NHAC_MUSIC_DIR;
			if (!musicDir) return;
			const music = resolve(musicDir);
			const libDir = resolve(process.cwd(), process.env.NHAC_LIBRARY_DIR || "library-data");
			const covers = resolve(libDir, "covers");
			server.config.logger.info(`  nhac: local library ${libDir}, music ${music}`);

			server.middlewares.use((req, res, next) => {
				const url = new URL(req.url ?? "/", "http://localhost");
				const path = url.pathname;
				const read = req.method === "GET" || req.method === "HEAD";

				if (path === "/api/logout" && req.method === "POST") return send(res, 200, '{"ok":true}', "application/json; charset=utf-8");
				if (path === "/api/login" && req.method === "POST") return send(res, 200, '{"ok":true}', "application/json; charset=utf-8");
				if (path === "/api/library" && read) {
					return void serveFile(req, res, resolve(libDir, "library.json"), "application/json; charset=utf-8", "no-cache");
				}
				if (path.startsWith("/cover/") && read) {
					const name = path.slice("/cover/".length);
					if (!/^[0-9a-f]{12}\.jpg$/.test(name)) return send(res, 404, "Not found");
					return void serveFile(req, res, resolve(covers, name), "image/jpeg", "private, max-age=3600");
				}
				if (path.startsWith("/stream/") && read) {
					const key = streamKey(path);
					const file = key ? resolve(music, key) : null;
					if (!file || !(file === music || file.startsWith(music + sep))) return send(res, 404, "Not found");
					const type = AUDIO_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
					return void serveFile(req, res, file, type, "private, max-age=86400");
				}
				if (path.startsWith("/api/")) return send(res, 404, '{"error":"not_found"}', "application/json; charset=utf-8");
				next();
			});
		},
	};
}
