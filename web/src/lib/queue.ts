// Pure play-queue logic. The engine (player.ts) owns audio; this file owns order.
// Track ids are unique within a queue: adding a queued track moves it instead of duplicating it.

export type Repeat = "off" | "all" | "one";

export interface QueueState {
	/** Play order (shuffled when shuffle is on) */
	items: string[];
	/** Order before shuffling, restored when shuffle turns off; null when not shuffled */
	original: string[] | null;
	/** Index of the current track in items; -1 when empty */
	index: number;
	shuffle: boolean;
	repeat: Repeat;
}

export type Rand = () => number;

export const emptyQueue: QueueState = { items: [], original: null, index: -1, shuffle: false, repeat: "off" };

function unique(ids: ReadonlyArray<string>): string[] {
	return [...new Set(ids)];
}

/** Fisher-Yates over everything except the current track, which moves to the front. */
export function shuffleKeepCurrent(items: ReadonlyArray<string>, index: number, rand: Rand = Math.random): string[] {
	const rest = items.filter((_, i) => i !== index);
	for (let i = rest.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[rest[i], rest[j]] = [rest[j], rest[i]];
	}
	return index >= 0 && index < items.length ? [items[index], ...rest] : rest;
}

export function currentId(s: QueueState): string | null {
	return s.index >= 0 && s.index < s.items.length ? s.items[s.index] : null;
}

/** Replace the queue with `ids`, starting at `start`. Keeps the repeat mode. */
export function replaceQueue(s: QueueState, ids: ReadonlyArray<string>, start: number, shuffle: boolean, rand: Rand = Math.random): QueueState {
	const items = unique(ids);
	const startId = ids[start];
	const index = Math.max(0, items.indexOf(startId));
	if (!items.length) return { ...s, items: [], original: null, index: -1, shuffle };
	if (!shuffle) return { ...s, items, original: null, index, shuffle: false };
	return { ...s, items: shuffleKeepCurrent(items, index, rand), original: items, index: 0, shuffle: true };
}

export function setShuffle(s: QueueState, on: boolean, rand: Rand = Math.random): QueueState {
	if (on === s.shuffle) return s;
	if (on) {
		if (!s.items.length) return { ...s, shuffle: true };
		return { ...s, items: shuffleKeepCurrent(s.items, s.index, rand), original: s.items, index: 0, shuffle: true };
	}
	const cur = currentId(s);
	const items = s.original ?? s.items;
	return { ...s, items, original: null, index: cur ? items.indexOf(cur) : -1, shuffle: false };
}

export function cycleRepeat(r: Repeat): Repeat {
	return r === "off" ? "all" : r === "all" ? "one" : "off";
}

/**
 * Index to play after the current one. `auto` means the track ended by itself: repeat-one then
 * replays it, while a manual "next" always moves on. Null means stop (end of queue).
 */
export function nextIndex(s: QueueState, auto: boolean): number | null {
	if (!s.items.length) return null;
	if (auto && s.repeat === "one") return s.index;
	if (s.index + 1 < s.items.length) return s.index + 1;
	return s.repeat === "off" ? null : 0;
}

export interface PrevAction {
	index: number;
	/** True when the current track should restart instead of changing */
	restart: boolean;
}

/** "Previous": restart when more than 3 s in (or at the very start of the queue), else go back. */
export function prevAction(s: QueueState, position: number): PrevAction {
	if (position > 3 || !s.items.length) return { index: s.index, restart: true };
	if (s.index > 0) return { index: s.index - 1, restart: false };
	if (s.repeat === "all" && s.items.length > 1) return { index: s.items.length - 1, restart: false };
	return { index: s.index, restart: true };
}

export function jumpTo(s: QueueState, index: number): QueueState {
	return index >= 0 && index < s.items.length ? { ...s, index } : s;
}

/**
 * Remove the item at `at`. When it is the current track, the following track becomes current
 * (or the previous one when it was the last); the caller decides whether to load it.
 */
export function removeAt(s: QueueState, at: number): QueueState {
	if (at < 0 || at >= s.items.length) return s;
	const id = s.items[at];
	const items = s.items.filter((_, i) => i !== at);
	let index = s.index;
	if (at < s.index) index--;
	else if (at === s.index) index = Math.min(at, items.length - 1);
	return { ...s, items, index, original: s.original?.filter((x) => x !== id) ?? null };
}

/** Move an item; the current track keeps playing wherever it lands. */
export function move(s: QueueState, from: number, to: number): QueueState {
	const n = s.items.length;
	if (from < 0 || from >= n || to < 0 || to >= n || from === to) return s;
	const cur = currentId(s);
	const items = [...s.items];
	const [id] = items.splice(from, 1);
	items.splice(to, 0, id);
	return { ...s, items, index: cur ? items.indexOf(cur) : s.index };
}

/** Keep only the current track. */
export function clearUpcoming(s: QueueState): QueueState {
	const cur = currentId(s);
	if (!cur) return { ...s, items: [], original: null, index: -1 };
	return { ...s, items: [cur], original: s.original ? [cur] : null, index: 0 };
}

function insertAfter(list: string[], anchor: string | null, ids: string[]): string[] {
	const rest = list.filter((x) => !ids.includes(x) || x === anchor);
	const at = anchor ? rest.indexOf(anchor) + 1 : 0;
	rest.splice(at, 0, ...ids.filter((x) => x !== anchor));
	return rest;
}

/** Queue tracks to play right after the current one. */
export function playNext(s: QueueState, ids: ReadonlyArray<string>): QueueState {
	const add = unique(ids);
	const cur = currentId(s);
	if (!cur) return { ...s, items: add, original: s.shuffle ? add : null, index: add.length ? 0 : -1 };
	const items = insertAfter(s.items, cur, add);
	const original = s.original ? insertAfter(s.original, cur, add) : null;
	return { ...s, items, original, index: items.indexOf(cur) };
}

/** Add tracks to the end of the queue. */
export function append(s: QueueState, ids: ReadonlyArray<string>): QueueState {
	const cur = currentId(s);
	const add = unique(ids).filter((x) => x !== cur);
	const items = [...s.items.filter((x) => !add.includes(x)), ...add];
	const original = s.original ? [...s.original.filter((x) => !add.includes(x)), ...add] : null;
	return { ...s, items, original, index: cur ? items.indexOf(cur) : items.length ? 0 : -1 };
}

/** Drop ids that no longer exist (library changed since the queue was saved). */
export function sanitize(s: QueueState, exists: (id: string) => boolean): QueueState {
	const cur = currentId(s);
	const items = unique(s.items.filter(exists));
	const original = s.original ? unique(s.original.filter(exists)) : null;
	let index = cur ? items.indexOf(cur) : -1;
	if (index === -1 && items.length) index = Math.min(Math.max(0, s.index), items.length - 1);
	return { ...s, items, original: s.shuffle ? original : null, index };
}
