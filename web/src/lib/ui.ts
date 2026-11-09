// Small UI state shared across components: persisted view prefs, layout mode, sheet state.
import { signal } from "@preact/signals";

export type AlbumSort = "artist" | "title" | "year";
export type AlbumFilter = "all" | "hires" | "cd";

function persisted<T extends string>(key: string, allowed: readonly T[], fallback: T) {
	let initial = fallback;
	try {
		const v = localStorage.getItem(key) as T | null;
		if (v && allowed.includes(v)) initial = v;
	} catch {
		// Storage unavailable: defaults apply.
	}
	const s = signal<T>(initial);
	s.subscribe((v) => {
		try {
			localStorage.setItem(key, v);
		} catch {
			// Not persisted.
		}
	});
	return s;
}

export const albumSort = persisted<AlbumSort>("nhac.albumSort", ["artist", "title", "year"], "artist");
export const albumFilter = persisted<AlbumFilter>("nhac.albumFilter", ["all", "hires", "cd"], "all");

const mobileQuery = typeof matchMedia === "undefined" ? null : matchMedia("(max-width: 768px)");
export const isMobile = signal(mobileQuery?.matches ?? false);
mobileQuery?.addEventListener("change", (e) => {
	isMobile.value = e.matches;
});

const reducedQuery = typeof matchMedia === "undefined" ? null : matchMedia("(prefers-reduced-motion: reduce)");
export function reducedMotion(): boolean {
	return reducedQuery?.matches ?? false;
}

/** Now Playing sheet (mobile) / overlay (desktop). */
export const nowPlayingOpen = signal(false);

/** Now Playing shows lyrics instead of the signal panel (when the track has lyrics). */
export const lyricsView = signal(false);

/** Search text, shared by the desktop top bar field and the mobile search view field. */
export const searchText = signal("");

/** Registered by whichever search field is visible, so shortcuts can focus it. */
let focusSearchField: (() => void) | null = null;
export function registerSearchField(fn: (() => void) | null) {
	focusSearchField = fn;
}
export function focusSearch() {
	focusSearchField?.();
}
