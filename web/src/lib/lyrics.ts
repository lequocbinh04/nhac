// Lyrics: LRC parsing and active-line lookup (pure). GET /lyrics/<trackId> returns LRC for synced
// lyrics and plain text otherwise.

export interface LyricLine {
	/** Seconds from the start of the track */
	time: number;
	/** Line text; "" marks an instrumental gap */
	text: string;
}

export type Lyrics = { kind: "synced"; lines: LyricLine[] } | { kind: "plain"; lines: string[] };

/** A gap at least this long gets a visible "instrumental" indicator. */
export const LONG_GAP_S = 6;

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/y;
const META_TAG = /^\[([a-zA-Z#]+):([^\]]*)\]\s*$/;
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

function seconds(min: string, sec: string, frac: string | undefined): number {
	return Number(min) * 60 + Number(sec) + (frac ? Number(`0.${frac}`) : 0);
}

function cleanText(s: string): string {
	return s.replace(WORD_TAG, "").replace(/\s+/g, " ").trim();
}

/**
 * Parse LRC. Lines may carry several timestamps ([00:12.00][01:05.30]chorus), fractions of one to
 * three digits, an [offset:±ms] tag (positive = lyrics earlier), metadata tags (ignored) and
 * enhanced word timings (<mm:ss.xx>, stripped). Blank timed lines are kept as instrumental gaps.
 * Returns null when nothing is timed (treat as plain text).
 */
export function parseLrc(src: string): LyricLine[] | null {
	const out: LyricLine[] = [];
	let offsetMs = 0;
	for (const raw of src.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
		const line = raw.trim();
		if (!line) continue;
		const meta = META_TAG.exec(line);
		if (meta) {
			if (meta[1].toLowerCase() === "offset") {
				const v = Number(meta[2].trim());
				if (Number.isFinite(v)) offsetMs = v;
			}
			continue;
		}
		const times: number[] = [];
		TIME_TAG.lastIndex = 0;
		let m: RegExpExecArray | null;
		let end = 0;
		while ((m = TIME_TAG.exec(line))) {
			times.push(seconds(m[1], m[2], m[3]));
			end = TIME_TAG.lastIndex;
		}
		if (!times.length) continue;
		const text = cleanText(line.slice(end));
		for (const time of times) out.push({ time, text });
	}
	if (!out.length) return null;
	const shift = offsetMs / 1000;
	for (const l of out) l.time = Math.max(0, Math.round((l.time - shift) * 1000) / 1000);
	// Array.prototype.sort is stable: lines sharing a timestamp keep file order.
	return out.sort((a, b) => a.time - b.time);
}

/** Plain text: drop LRC metadata/time tags if any slipped in, keep stanza breaks (max one blank line). */
export function parsePlain(src: string): string[] {
	const lines: string[] = [];
	for (const raw of src.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
		if (META_TAG.test(raw.trim())) continue;
		const text = cleanText(raw.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, ""));
		if (!text && (!lines.length || lines[lines.length - 1] === "")) continue;
		lines.push(text);
	}
	while (lines.length && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

/** Synced when the text has timestamps (and the library didn't say "plain"), else plain. */
export function parseLyrics(src: string, hint?: "synced" | "plain"): Lyrics {
	if (hint !== "plain") {
		const lines = parseLrc(src);
		if (lines && lines.some((l) => l.text)) return { kind: "synced", lines };
	}
	return { kind: "plain", lines: parsePlain(src) };
}

/** Index of the line sung at `t` (last line starting at or before t), -1 before the first line. */
export function activeIndex(lines: ReadonlyArray<LyricLine>, t: number): number {
	let lo = 0;
	let hi = lines.length - 1;
	let ans = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (lines[mid].time <= t) {
			ans = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return ans;
}

export interface LyricRow extends LyricLine {
	/** Instrumental gap long enough to show the waiting indicator */
	longGap: boolean;
}

/**
 * Rows to display: an intro gap row when the first line starts LONG_GAP_S in, blank lines as gaps
 * (repeats collapsed). A gap is "long" when the next sung line (or the track end) is LONG_GAP_S away.
 */
export function lyricRows(lines: ReadonlyArray<LyricLine>, duration: number): LyricRow[] {
	const rows: LyricRow[] = [];
	if (lines.length && lines[0].text && lines[0].time >= LONG_GAP_S) rows.push({ time: 0, text: "", longGap: false });
	for (const l of lines) {
		const prev = rows[rows.length - 1];
		if (!l.text && prev && !prev.text) continue;
		rows.push({ ...l, longGap: false });
	}
	let nextSung = Number.isFinite(duration) && duration > 0 ? duration : Number.NaN;
	for (let i = rows.length - 1; i >= 0; i--) {
		if (rows[i].text) nextSung = rows[i].time;
		else rows[i].longGap = nextSung - rows[i].time >= LONG_GAP_S;
	}
	return rows;
}
