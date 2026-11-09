// Loads /api/library once and exposes the catalog. A missing session sends the user to /login.
import { signal } from "@preact/signals";
import { buildCatalog, type Catalog } from "./catalog";
import { loginPath } from "./links";
import type { LibraryData } from "./types";

export type LibraryState = { status: "loading" } | { status: "error" } | { status: "ready"; catalog: Catalog };

export const library = signal<LibraryState>({ status: "loading" });

/** The loaded catalog. Only call from views rendered after the library is ready. */
export function catalog(): Catalog {
	const s = library.value;
	if (s.status !== "ready") throw new Error("library not loaded");
	return s.catalog;
}

export async function loadLibrary(): Promise<Catalog | null> {
	library.value = { status: "loading" };
	try {
		const res = await fetch("/api/library", { credentials: "same-origin", cache: "no-cache", headers: { Accept: "application/json" } });
		if (res.status === 401) {
			location.replace(loginPath(location.pathname, location.search));
			return null;
		}
		if (!res.ok) throw new Error(`library ${res.status}`);
		const data = (await res.json()) as LibraryData;
		const c = buildCatalog(data);
		library.value = { status: "ready", catalog: c };
		return c;
	} catch (err) {
		console.warn("nhac: library failed to load", err);
		library.value = { status: "error" };
		return null;
	}
}
