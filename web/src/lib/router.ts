// Client-side router on the History API. Each history entry gets a key; scroll positions are
// remembered per key so back/forward lands where the user left off.
import { signal } from "@preact/signals";

export type Route =
	| { name: "albums" }
	| { name: "album"; id: string }
	| { name: "artists" }
	| { name: "artist"; key: string }
	| { name: "songs" }
	| { name: "queue" }
	| { name: "search"; q: string }
	| { name: "settings" }
	| { name: "notfound" };

/** How the current route was reached: drives scroll reset/restore and the view transition. */
export type NavKind = "initial" | "push" | "pop" | "replace";

export interface Nav {
	route: Route;
	kind: NavKind;
	/** Keyboard-initiated navigation never animates */
	keyboard: boolean;
	key: string;
}

export function parseRoute(pathname: string, search: string): Route {
	const parts = pathname.split("/").filter(Boolean).map((p) => {
		try {
			return decodeURIComponent(p);
		} catch {
			return p;
		}
	});
	const [a, b] = parts;
	if (parts.length === 0) return { name: "albums" };
	if (a === "albums" && parts.length === 1) return { name: "albums" };
	if (a === "albums" && b && parts.length === 2) return { name: "album", id: b };
	if (a === "artists" && parts.length === 1) return { name: "artists" };
	if (a === "artists" && b && parts.length === 2) return { name: "artist", key: b };
	if (a === "songs" && parts.length === 1) return { name: "songs" };
	if (a === "queue" && parts.length === 1) return { name: "queue" };
	if (a === "search" && parts.length === 1) return { name: "search", q: new URLSearchParams(search).get("q") ?? "" };
	if (a === "settings" && parts.length === 1) return { name: "settings" };
	return { name: "notfound" };
}

export const href = {
	albums: () => "/",
	album: (id: string) => `/albums/${encodeURIComponent(id)}`,
	artists: () => "/artists",
	artist: (key: string) => `/artists/${encodeURIComponent(key)}`,
	songs: () => "/songs",
	queue: () => "/queue",
	search: (q: string) => (q ? `/search?q=${encodeURIComponent(q)}` : "/search"),
	settings: () => "/settings",
};

const SCROLL_KEY = "nhac.scroll";
const scrolls = new Map<string, number>(readScrolls());

function readScrolls(): [string, number][] {
	try {
		return JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? "[]");
	} catch {
		return [];
	}
}

function newKey(): string {
	return Math.random().toString(36).slice(2, 10);
}

function currentKey(): string {
	const k = (history.state as { key?: string } | null)?.key;
	if (k) return k;
	const key = newKey();
	history.replaceState({ ...(history.state ?? {}), key }, "");
	return key;
}

export const nav = signal<Nav>({ route: { name: "albums" }, kind: "initial", keyboard: false, key: "" });

let scrollEl: () => HTMLElement | null = () => null;

/** The element that scrolls the main content (set by the shell). */
export function setScrollElement(get: () => HTMLElement | null) {
	scrollEl = get;
}

export function scrollElement(): HTMLElement | null {
	return scrollEl();
}

function saveScroll() {
	const el = scrollEl();
	if (!el || !nav.value.key) return;
	scrolls.set(nav.value.key, el.scrollTop);
	try {
		sessionStorage.setItem(SCROLL_KEY, JSON.stringify([...scrolls].slice(-50)));
	} catch {
		// Not fatal: restoration only works within this page load.
	}
}

export function savedScroll(key: string): number | undefined {
	return scrolls.get(key);
}

export function navigate(to: string, opts: { replace?: boolean; keyboard?: boolean } = {}) {
	const url = new URL(to, location.href);
	if (url.origin !== location.origin) {
		location.href = to;
		return;
	}
	const same = url.pathname + url.search === location.pathname + location.search;
	if (same && !opts.replace) return;
	if (opts.replace) {
		history.replaceState(history.state, "", url.pathname + url.search);
		nav.value = { route: parseRoute(url.pathname, url.search), kind: "replace", keyboard: !!opts.keyboard, key: nav.value.key };
		return;
	}
	saveScroll();
	const key = newKey();
	const depth = ((history.state as { depth?: number } | null)?.depth ?? 0) + 1;
	history.pushState({ key, depth }, "", url.pathname + url.search);
	nav.value = { route: parseRoute(url.pathname, url.search), kind: "push", keyboard: !!opts.keyboard, key };
}

/** Go back within the app when there is an in-app entry behind this one, else to `fallback`. */
export function back(fallback: string) {
	if (((history.state as { depth?: number } | null)?.depth ?? 0) > 0) history.back();
	else navigate(fallback);
}

export function startRouter() {
	history.scrollRestoration = "manual";
	nav.value = { route: parseRoute(location.pathname, location.search), kind: "initial", keyboard: false, key: currentKey() };
	addEventListener("popstate", () => {
		saveScroll();
		nav.value = { route: parseRoute(location.pathname, location.search), kind: "pop", keyboard: false, key: currentKey() };
	});
	addEventListener("pagehide", saveScroll);
	// Same-origin <a href> clicks become client-side navigations (modifier clicks keep browser behaviour).
	document.addEventListener("click", (e) => {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const a = (e.target as Element | null)?.closest?.("a[href]");
		if (!(a instanceof HTMLAnchorElement) || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
		if (!a.pathname.startsWith("/") || a.pathname.startsWith("/stream/") || a.pathname.startsWith("/cover/") || a.pathname === "/login") return;
		e.preventDefault();
		// detail === 0: activated from the keyboard (Enter), not a pointer.
		navigate(a.pathname + a.search, { keyboard: e.detail === 0 });
	});
}
