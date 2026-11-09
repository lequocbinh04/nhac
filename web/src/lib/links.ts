// Pure URL helpers: shareable paths, the `?t=` start position, and the post-login return path.

/** Positions at or below this are shared as a plain link (starting from the top). */
export const MIN_SHARE_START_S = 5;

/** `/track/<id>`, with `?t=<whole seconds>` when a start position past the first seconds is given. */
export function trackPath(id: string, at?: number): string {
	const base = `/track/${encodeURIComponent(id)}`;
	return at !== undefined && Number.isFinite(at) && at > MIN_SHARE_START_S ? `${base}?t=${Math.floor(at)}` : base;
}

export function albumPath(id: string): string {
	return `/albums/${encodeURIComponent(id)}`;
}

/**
 * Parse `?t=`: plain seconds ("90", "90.5") or m:ss / h:mm:ss ("1:30"). Anything else is 0.
 * Clamped to the track so a stale link never seeks past the end (last second kept playable).
 */
export function parseStart(raw: string | null | undefined, duration: number): number {
	const s = (raw ?? "").trim();
	let seconds = 0;
	if (/^\d+(\.\d+)?$/.test(s)) seconds = Number(s);
	else if (/^\d+(:[0-5]\d){1,2}$/.test(s)) seconds = s.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
	const max = Number.isFinite(duration) && duration > 1 ? duration - 1 : 0;
	return Math.floor(Math.min(Math.max(0, seconds), max));
}

/** Where a 401 sends the user: `/login`, carrying the current path back unless it is the home page. */
export function loginPath(pathname: string, search: string): string {
	const here = pathname + search;
	if (here === "/" || here === "" || pathname === "/login" || pathname.startsWith("/login/")) return "/login";
	return `/login?next=${encodeURIComponent(here)}`;
}
