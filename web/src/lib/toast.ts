// Quiet toasts: one line of text, auto-dismissed. Timers pause while the tab is hidden.
import { signal } from "@preact/signals";

export interface Toast {
	id: number;
	text: string;
	/** Selectable second line (e.g. a link the clipboard refused); the toast then takes pointer input */
	detail?: string;
	leaving: boolean;
}

export const toasts = signal<Toast[]>([]);

const VISIBLE_MS = 3200;
const DETAIL_MS = 9000;
const EXIT_MS = 160;
const MAX = 3;
let nextId = 1;

function dismiss(id: number) {
	toasts.value = toasts.value.map((t) => (t.id === id ? { ...t, leaving: true } : t));
	setTimeout(() => {
		toasts.value = toasts.value.filter((t) => t.id !== id);
	}, EXIT_MS);
}

function schedule(id: number, ms: number) {
	const started = Date.now();
	const timer = setTimeout(() => {
		document.removeEventListener("visibilitychange", onVis);
		dismiss(id);
	}, ms);
	function onVis() {
		if (document.visibilityState !== "hidden") return;
		clearTimeout(timer);
		document.removeEventListener("visibilitychange", onVis);
		const left = Math.max(800, ms - (Date.now() - started));
		const resume = () => {
			if (document.visibilityState !== "visible") return;
			document.removeEventListener("visibilitychange", resume);
			schedule(id, left);
		};
		document.addEventListener("visibilitychange", resume);
	}
	document.addEventListener("visibilitychange", onVis);
}

export function toast(text: string, opts: { detail?: string } = {}) {
	const id = nextId++;
	const list = toasts.value.filter((t) => t.text !== text);
	toasts.value = [...list, { id, text, detail: opts.detail, leaving: false }].slice(-MAX);
	schedule(id, opts.detail ? DETAIL_MS : VISIBLE_MS);
}
