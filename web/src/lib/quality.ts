// Authenticity verdicts and spectrogram axes. Pure: strings come from the dictionary passed in.
import { formatRate, formatTime } from "./format";
import type { Dict } from "./i18n";
import type { QualityVerdict, Track, TrackQuality } from "./types";

/** Below this the analyser's accusation is not shown as one. */
const MIN_CONFIDENCE = 0.7;

/** The verdict to show: a lossy/upsampled call with low confidence is "unknown". Null: not analysed. */
export function verdictOf(q: TrackQuality | undefined): QualityVerdict | null {
	if (!q) return null;
	if ((q.verdict === "lossy" || q.verdict === "upsampled") && !(q.confidence >= MIN_CONFIDENCE)) return "unknown";
	return q.verdict;
}

export function isSuspect(t: Pick<Track, "quality">): boolean {
	const v = verdictOf(t.quality);
	return v === "lossy" || v === "upsampled";
}

/** 16000 -> "16", 15840 -> "15.8", 22050 -> "22.05" with digits = 2. Trailing zeros dropped. */
export function formatKhz(hz: number, digits = 1): string {
	const f = 10 ** digits;
	return String(Math.round((hz / 1000) * f) / f);
}

/** Source token when the analyser gave none: "16-bit" from empty low bits, else a rate from the cutoff. */
function upsampledSource(t: Pick<Track, "bits">, q: TrackQuality): string {
	if (q.effectiveBits && q.effectiveBits < t.bits) return `${q.effectiveBits}-bit`;
	if (q.cutoffHz <= 24_500) return "44.1/48k";
	return q.cutoffHz <= 49_000 ? "88.2/96k" : "";
}

export interface QualityText {
	verdict: QualityVerdict;
	/** Short badge text: "Lossless", "Upsampled", "Lossy source" */
	label: string;
	/** What follows the label: "44.1k source", "~16 kHz" */
	detail: string | null;
	/** One sentence: what the spectrum shows and what it means */
	why: string;
}

export function describeQuality(t: Pick<Track, "quality" | "sr" | "bits">, d: Dict): QualityText | null {
	const q = t.quality;
	const verdict = verdictOf(q);
	if (!q || !verdict) return null;
	const cut = q.cutoffHz > 0 ? formatKhz(q.cutoffHz) : null;
	switch (verdict) {
		case "lossless":
			return { verdict, label: d.qLossless, detail: null, why: cut ? d.qWhyLossless(cut) : d.qWhyLosslessBits };
		case "lossy":
			return { verdict, label: d.qLossy, detail: cut ? `~${cut} kHz` : null, why: d.qWhyLossy(cut ?? "?", q.source || "MP3/AAC") };
		case "upsampled": {
			const src = q.source || upsampledSource(t, q);
			const rate = /\dk\b/.test(src);
			return {
				verdict,
				label: d.qUpsampled,
				detail: src ? d.qSourceOf(src) : null,
				why: rate && cut ? d.qWhyUpRate(cut, formatRate(t.sr), src) : d.qWhyUpBits(t.bits, src),
			};
		}
		default:
			return { verdict, label: d.qUnknown, detail: null, why: d.qWhyUnknown(cut) };
	}
}

export interface AxisTick {
	/** Position along the axis, 0..1 */
	at: number;
	label: string;
	/** The far edge of the axis (Nyquist), labelled exactly */
	edge?: boolean;
}

/** Leave a regular tick out when it would crowd the edge label (fraction of the axis). */
const EDGE_GAP = 0.08;

/**
 * Frequency ticks in kHz from 0 to Nyquist: a round step giving at most six intervals, plus the
 * exact Nyquist at the top ("22.05") so the image's real range is readable.
 */
export function freqTicks(nyquistHz: number): AxisTick[] {
	if (!(nyquistHz > 0)) return [];
	const step = [1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000].find((s) => nyquistHz / s <= 6) ?? 200_000;
	const ticks: AxisTick[] = [];
	for (let hz = 0; hz < nyquistHz * (1 - EDGE_GAP); hz += step) ticks.push({ at: hz / nyquistHz, label: formatKhz(hz) });
	ticks.push({ at: 1, label: formatKhz(nyquistHz, 2), edge: true });
	return ticks;
}

/** Time ticks over the whole track: a round step giving at most six intervals, "0:00" first. */
export function timeTicks(seconds: number): AxisTick[] {
	if (!(seconds > 0)) return [];
	const step = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].find((s) => seconds / s <= 6) ?? 7200;
	const ticks: AxisTick[] = [];
	for (let s = 0; s < seconds * (1 - EDGE_GAP); s += step) ticks.push({ at: s / seconds, label: formatTime(s) });
	return ticks;
}

/** Counts per verdict over the tracks (low-confidence accusations count as unknown). */
export function qualityCounts(tracks: ReadonlyArray<Pick<Track, "quality">>): Record<QualityVerdict | "none", number> {
	const out = { lossless: 0, upsampled: 0, lossy: 0, unknown: 0, none: 0 };
	for (const t of tracks) out[verdictOf(t.quality) ?? "none"]++;
	return out;
}
