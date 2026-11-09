// Lyrics for the current track only: fetched when a track with lyrics becomes current, aborted on
// track change, the last few kept in memory. Nothing is prefetched.
import { effect, signal } from "@preact/signals";
import { loginPath } from "./links";
import { parseLyrics, type Lyrics } from "./lyrics";
import * as player from "./player";

export type LyricsState =
	| { status: "none" }
	| { status: "loading"; id: string }
	| { status: "error"; id: string }
	| { status: "ready"; id: string; lyrics: Lyrics };

export const lyrics = signal<LyricsState>({ status: "none" });

const CACHE_SIZE = 6;
const cache = new Map<string, Lyrics>();

function remember(id: string, l: Lyrics) {
	cache.delete(id);
	cache.set(id, l);
	while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

export function startLyrics() {
	let controller: AbortController | null = null;
	effect(() => {
		const t = player.current.value;
		controller?.abort();
		controller = null;
		if (!t?.lyrics) {
			lyrics.value = { status: "none" };
			return;
		}
		const hit = cache.get(t.id);
		if (hit) {
			remember(t.id, hit);
			lyrics.value = { status: "ready", id: t.id, lyrics: hit };
			return;
		}
		const ctl = new AbortController();
		controller = ctl;
		const id = t.id;
		const hint = t.lyrics;
		lyrics.value = { status: "loading", id };
		fetch(`/lyrics/${encodeURIComponent(id)}`, { credentials: "same-origin", signal: ctl.signal })
			.then(async (res) => {
				if (ctl.signal.aborted) return;
				if (res.status === 401) {
					location.replace(loginPath(location.pathname, location.search));
					return;
				}
				if (res.status === 404) {
					lyrics.value = { status: "none" };
					return;
				}
				if (!res.ok) throw new Error(`lyrics ${res.status}`);
				const parsed = parseLyrics(await res.text(), hint);
				if (!parsed.lines.length) {
					lyrics.value = { status: "none" };
					return;
				}
				remember(id, parsed);
				if (!ctl.signal.aborted) lyrics.value = { status: "ready", id, lyrics: parsed };
			})
			.catch(() => {
				if (!ctl.signal.aborted) lyrics.value = { status: "error", id };
			});
	});
}
