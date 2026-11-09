import { AwsClient } from "aws4fetch";

const CONTENT_TYPES: Record<string, string> = {
	flac: "audio/flac",
	m4a: "audio/mp4",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	aiff: "audio/aiff",
	aif: "audio/aiff",
	ogg: "audio/ogg",
	opus: "audio/ogg",
	json: "application/json; charset=utf-8",
	jpg: "image/jpeg",
};

/** Serve one object from the configured bucket, honouring Range and conditional request headers. */
export function serveObject(request: Request, env: Env, key: string, cacheControl: string): Promise<Response> {
	const type = CONTENT_TYPES[key.split(".").pop()?.toLowerCase() ?? ""];
	return env.STORAGE === "s3" ? fromS3(request, env, key, cacheControl, type) : fromR2(request, env, key, cacheControl, type);
}

async function fromR2(request: Request, env: Env, key: string, cacheControl: string, type: string | undefined): Promise<Response> {
	const object = await env.MUSIC.get(key, { range: request.headers, onlyIf: request.headers });
	if (object === null) return new Response("Not found", { status: 404 });
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("ETag", object.httpEtag);
	headers.set("Accept-Ranges", "bytes");
	headers.set("Cache-Control", cacheControl);
	if (type) headers.set("Content-Type", type);
	if (!("body" in object)) return new Response(null, { status: 304, headers });
	if (request.headers.has("Range") && object.range) {
		// R2 reports {offset, length} with suffix present but undefined, so test values, not keys.
		const r: { offset?: number; length?: number; suffix?: number } = object.range;
		const start = r.suffix !== undefined ? object.size - r.suffix : (r.offset ?? 0);
		const end = r.suffix !== undefined ? object.size - 1 : Math.min(start + (r.length ?? object.size - start) - 1, object.size - 1);
		headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
		headers.set("Content-Length", String(end - start + 1));
		return new Response(object.body, { status: 206, headers });
	}
	headers.set("Content-Length", String(object.size));
	return new Response(object.body, { status: 200, headers });
}

const FORWARDED_REQUEST_HEADERS = ["Range", "If-None-Match", "If-Modified-Since", "If-Match", "If-Range"];
const FORWARDED_RESPONSE_HEADERS = ["Content-Type", "Content-Length", "Content-Range", "ETag", "Last-Modified", "Accept-Ranges"];

async function fromS3(request: Request, env: Env, key: string, cacheControl: string, type: string | undefined): Promise<Response> {
	if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
		return new Response("S3 storage is not configured", { status: 500 });
	}
	const client = new AwsClient({
		accessKeyId: env.S3_ACCESS_KEY_ID,
		secretAccessKey: env.S3_SECRET_ACCESS_KEY,
		region: env.S3_REGION || "auto",
		service: "s3",
	});
	const path = key.split("/").map(encodeURIComponent).join("/");
	const url = `${env.S3_ENDPOINT.replace(/\/+$/, "")}/${encodeURIComponent(env.S3_BUCKET)}/${path}`;
	const upstreamHeaders = new Headers();
	for (const name of FORWARDED_REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value) upstreamHeaders.set(name, value);
	}
	const upstream = await client.fetch(url, { method: request.method === "HEAD" ? "HEAD" : "GET", headers: upstreamHeaders });
	if (upstream.status === 404 || upstream.status === 403) {
		await upstream.body?.cancel();
		return new Response("Not found", { status: 404 });
	}
	const headers = new Headers();
	for (const name of FORWARDED_RESPONSE_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) headers.set(name, value);
	}
	headers.set("Cache-Control", cacheControl);
	if (type) headers.set("Content-Type", type);
	return new Response(upstream.body, { status: upstream.status, headers });
}
