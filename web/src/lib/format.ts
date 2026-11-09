// Pure formatting helpers for times and audio specs. No DOM, no i18n state.
import type { Track } from "./types";

/** 192.4 -> "3:12", 3725 -> "1:02:05". Invalid or negative input -> "0:00". */
export function formatTime(seconds: number): string {
	const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const CODEC_LABELS: Record<string, string> = {
	flac: "FLAC",
	alac: "ALAC",
	aac: "AAC",
	mp3: "MP3",
	opus: "Opus",
	vorbis: "Vorbis",
	wavpack: "WavPack",
	ape: "APE",
};

/** ffprobe codec name -> short display label. Raw PCM (WAV/AIFF) shows as "WAV". */
export function codecLabel(codec: string): string {
	const c = codec.toLowerCase();
	if (c.startsWith("pcm_")) return "WAV";
	return CODEC_LABELS[c] ?? c.toUpperCase();
}

export function isLossless(codec: string): boolean {
	const c = codec.toLowerCase();
	return c === "flac" || c === "alac" || c === "wavpack" || c === "ape" || c.startsWith("pcm_");
}

/** 44100 -> "44.1", 48000 -> "48", 176400 -> "176.4" (kHz, at most one decimal). */
export function formatRate(sr: number): string {
	return String(Math.round(sr / 100) / 10);
}

/** Track spec chip: "24/192" for PCM-based formats, the codec label for lossy ones. */
export function trackSpec(t: Pick<Track, "bits" | "sr" | "codec">): string {
	return t.bits > 0 ? `${t.bits}/${formatRate(t.sr)}` : codecLabel(t.codec);
}

function range(values: number[], fmt: (n: number) => string): string {
	let lo = Infinity;
	let hi = -Infinity;
	for (const v of values) {
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}
	if (lo === Infinity) return "";
	return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
}

export interface SpecSummary {
	/** "FLAC" or "FLAC/MP3" */
	codec: string;
	/** "24/48", "16–24/44.1", "" when every track is lossy */
	spec: string;
	hiRes: boolean;
	/** Every track is 16-bit / 44.1 kHz */
	cd: boolean;
	seconds: number;
}

/** Aggregate spec of a set of tracks (an album). */
export function summarize(tracks: ReadonlyArray<Pick<Track, "bits" | "sr" | "codec" | "dur">>): SpecSummary {
	const codecs: string[] = [];
	const bits: number[] = [];
	const rates: number[] = [];
	let seconds = 0;
	let hiRes = false;
	let cd = tracks.length > 0;
	for (const t of tracks) {
		const label = codecLabel(t.codec);
		if (!codecs.includes(label)) codecs.push(label);
		if (t.bits > 0) {
			bits.push(t.bits);
			rates.push(t.sr);
		}
		if (t.bits >= 24) hiRes = true;
		if (t.bits !== 16 || t.sr !== 44100) cd = false;
		seconds += t.dur || 0;
	}
	const b = range(bits, String);
	const spec = b ? `${b}/${range(rates, formatRate)}` : "";
	return { codec: codecs.join("/"), spec, hiRes, cd, seconds };
}

/** Short spec for grid cards: "24/48", "16–24/44.1", or the lossy codec label. */
export function shortSpec(s: SpecSummary): string {
	return s.spec || s.codec;
}

export interface QualityParts {
	codec: string;
	bits: number | null;
	khz: string;
}

export function qualityParts(t: Pick<Track, "bits" | "sr" | "codec">): QualityParts {
	return { codec: codecLabel(t.codec), bits: t.bits > 0 ? t.bits : null, khz: formatRate(t.sr) };
}

/** Bytes -> "44,8 GB" (vi) / "44.8 GB" (en), decimal units like Finder. */
export function formatBytes(bytes: number, locale: string): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let v = Math.max(0, bytes);
	let i = 0;
	while (v >= 1000 && i < units.length - 1) {
		v /= 1000;
		i++;
	}
	const digits = i === 0 || v >= 100 ? 0 : 1;
	return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)} ${units[i]}`;
}

/** /stream/ URL for a bucket key: every path segment is percent-encoded, "/" kept. */
export function streamUrl(file: string): string {
	return `/stream/${file.split("/").map(encodeURIComponent).join("/")}`;
}

export function coverUrl(albumId: string): string {
	return `/cover/${albumId}.jpg`;
}
