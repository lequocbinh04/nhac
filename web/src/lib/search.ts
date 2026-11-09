// Diacritic-insensitive search. "dong ha" matches "Đông Hà K-Lo"; matched spans map back to the
// original text so highlights land on the exact characters the user sees.

const foldCache = new Map<string, string>();

function foldChar(ch: string): string {
	let f = foldCache.get(ch);
	if (f === undefined) {
		f = ch.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();
		foldCache.set(ch, f);
	}
	return f;
}

/** Lowercase, strip combining marks (Vietnamese tones), đ -> d. */
export function fold(s: string): string {
	let out = "";
	for (const ch of s) out += foldChar(ch);
	return out;
}

export interface Folded {
	/** Original text */
	raw: string;
	/** Folded text */
	text: string;
	/** text[i] came from raw[map[i]] (UTF-16 offsets) */
	map: number[];
}

export function foldWithMap(raw: string): Folded {
	let text = "";
	const map: number[] = [];
	let i = 0;
	for (const ch of raw) {
		const f = foldChar(ch);
		for (let k = 0; k < f.length; k++) map.push(i);
		text += f;
		i += ch.length;
	}
	return { raw, text, map };
}

export type Span = [start: number, end: number];

const MARK = /\p{M}/u;

/** Folded span -> original span, extended over trailing combining marks (NFD input). */
export function toRawSpan(f: Folded, start: number, end: number): Span {
	const s = f.map[start];
	const last = f.map[end - 1];
	const cp = f.raw.codePointAt(last) ?? 0;
	let e = last + (cp > 0xffff ? 2 : 1);
	while (e < f.raw.length && MARK.test(f.raw[e])) e++;
	return [s, e];
}

function isWordStart(text: string, i: number): boolean {
	return i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]);
}

/** Every occurrence, preferring one at a word start. */
function findBest(text: string, needle: string): number {
	let first = -1;
	for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
		if (isWordStart(text, i)) return i;
		if (first === -1) first = i;
	}
	return first;
}

export interface Query {
	text: string;
	tokens: string[];
}

export function parseQuery(q: string): Query {
	const text = fold(q).trim().replace(/\s+/g, " ");
	return { text, tokens: text ? text.split(" ") : [] };
}

export interface FieldMatch {
	score: number;
	spans: Span[];
}

/** Score one field against the whole phrase. Null when the phrase does not occur. */
export function matchPhrase(f: Folded, q: Query): FieldMatch | null {
	if (!q.text) return null;
	const i = findBest(f.text, q.text);
	if (i === -1) return null;
	let score: number;
	if (f.text === q.text) score = 100;
	else if (i === 0) score = 90;
	else if (isWordStart(f.text, i)) score = 75;
	else score = 55;
	// Among equal kinds, the tighter match (query covers more of the field) wins.
	score += (q.text.length / f.text.length) * 8;
	return { score, spans: [toRawSpan(f, i, i + q.text.length)] };
}

export interface Entry<T> {
	item: T;
	/** fields[0] is the primary field (name/title); the rest are context (artist, album) */
	fields: Folded[];
	/** Small tie-break bonus, e.g. by result kind */
	bias: number;
}

export interface Hit<T> {
	item: T;
	score: number;
	/** Highlight spans per field, parallel to entry.fields */
	spans: Span[][];
}

const SECONDARY_WEIGHT = 0.7;

/**
 * Phrase match on any field (primary weighs more); otherwise every token must appear in some
 * field, which lets "lune small hours" find the album Small Hours by Ferro & Lune.
 */
export function matchEntry<T>(e: Entry<T>, q: Query): Hit<T> | null {
	if (!q.tokens.length) return null;
	const spans: Span[][] = e.fields.map(() => []);
	let best = 0;
	e.fields.forEach((f, fi) => {
		const m = matchPhrase(f, q);
		if (!m) return;
		const s = fi === 0 ? m.score : m.score * SECONDARY_WEIGHT;
		if (s > best) best = s;
		spans[fi].push(...m.spans);
	});
	if (best > 0) return { item: e.item, score: best + e.bias, spans };

	if (q.tokens.length < 2) return null;
	let total = 0;
	for (const tok of q.tokens) {
		let tokBest = 0;
		let at: { fi: number; span: Span } | null = null;
		e.fields.forEach((f, fi) => {
			const i = findBest(f.text, tok);
			if (i === -1) return;
			const s = (isWordStart(f.text, i) ? 40 : 28) * (fi === 0 ? 1 : SECONDARY_WEIGHT);
			if (s > tokBest) {
				tokBest = s;
				at = { fi, span: toRawSpan(f, i, i + tok.length) };
			}
		});
		if (!at) return null;
		const found: { fi: number; span: Span } = at;
		spans[found.fi].push(found.span);
		total += tokBest;
	}
	return { item: e.item, score: total / q.tokens.length + e.bias, spans };
}

export function makeEntry<T>(item: T, fields: string[], bias = 0): Entry<T> {
	return { item, fields: fields.map(foldWithMap), bias };
}

/** Ranked hits, best first; ties keep index order (library order). */
export function searchEntries<T>(entries: ReadonlyArray<Entry<T>>, q: Query, limit = Infinity): { hits: Hit<T>[]; total: number } {
	const hits: Hit<T>[] = [];
	for (const e of entries) {
		const h = matchEntry(e, q);
		if (h) hits.push(h);
	}
	hits.sort((a, b) => b.score - a.score);
	return { hits: hits.length > limit ? hits.slice(0, limit) : hits, total: hits.length };
}

export interface Part {
	text: string;
	hit: boolean;
}

/** Split text into plain and highlighted parts. Overlapping or unordered spans are merged. */
export function highlightParts(text: string, spans: ReadonlyArray<Span>): Part[] {
	if (!spans.length) return [{ text, hit: false }];
	const sorted = [...spans].sort((a, b) => a[0] - b[0]);
	const merged: Span[] = [];
	for (const [s, e] of sorted) {
		const last = merged[merged.length - 1];
		if (last && s <= last[1]) last[1] = Math.max(last[1], e);
		else merged.push([s, e]);
	}
	const parts: Part[] = [];
	let pos = 0;
	for (const [s, e] of merged) {
		if (s > pos) parts.push({ text: text.slice(pos, s), hit: false });
		parts.push({ text: text.slice(s, e), hit: true });
		pos = e;
	}
	if (pos < text.length) parts.push({ text: text.slice(pos), hit: false });
	return parts;
}
