// Real stereo level meter: MediaElementSource -> ChannelSplitter -> two AnalyserNodes.
// Disabled on iOS/iPadOS: WebKit suspends an AudioContext in the background, and once an
// <audio> element is routed through Web Audio that would silence the music. Where disabled the
// UI hides the meter instead of faking one.
import { signal } from "@preact/signals";

export function isAppleMobile(): boolean {
	if (typeof navigator === "undefined") return false;
	const ua = navigator.userAgent;
	// iPadOS 13+ reports itself as a Mac; touch support gives it away.
	return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

type MeterSupport = "on" | "ios" | "unavailable";

export const meterSupport: MeterSupport =
	typeof window === "undefined" || typeof AudioContext === "undefined" ? "unavailable" : isAppleMobile() ? "ios" : "on";

/** Output sample rate of the AudioContext, once the graph exists. */
export const outputRate = signal<number | null>(null);
/** The graph failed to build on this browser: hide the meter rather than show a dead one. */
export const meterBroken = signal(false);

let ctx: AudioContext | null = null;
let analysers: [AnalyserNode, AnalyserNode] | null = null;
let buffer: Float32Array<ArrayBuffer> | null = null;

/**
 * Route the player's audio elements through the meter graph, once. Call only from a user
 * gesture (a play click or key) so the context starts running: a context created without user
 * activation starts suspended and would silence the routed audio.
 */
export function enableMeter(elements: HTMLMediaElement[]): void {
	if (meterSupport !== "on" || ctx || meterBroken.value) return;
	const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
	if (activation && !activation.isActive) return;
	try {
		const c = new AudioContext({ latencyHint: "playback" });
		// A splitter is always "discrete"; this gain upmixes mono to both channels first so a mono
		// file moves both bars. It only feeds the analysers, never the speakers.
		const upmix = c.createGain();
		upmix.channelCount = 2;
		upmix.channelCountMode = "explicit";
		upmix.channelInterpretation = "speakers";
		const splitter = c.createChannelSplitter(2);
		upmix.connect(splitter);
		const pair = [c.createAnalyser(), c.createAnalyser()] as [AnalyserNode, AnalyserNode];
		pair.forEach((a, i) => {
			a.fftSize = 1024;
			a.smoothingTimeConstant = 0;
			splitter.connect(a, i);
		});
		for (const el of elements) {
			const src = c.createMediaElementSource(el);
			src.connect(c.destination);
			src.connect(upmix);
		}
		ctx = c;
		analysers = pair;
		buffer = new Float32Array(pair[0].fftSize);
		outputRate.value = c.sampleRate;
		if (c.state !== "running") void c.resume();
	} catch (err) {
		// Don't retry on every play; the meter stays hidden.
		meterBroken.value = true;
		console.warn("nhac: level meter unavailable", err);
	}
}

/** Resume a suspended context (call on play). */
export function resumeMeter(): void {
	if (ctx && ctx.state !== "running") void ctx.resume().catch(() => undefined);
}

/** Peak absolute sample per channel over the last analyser window (linear, 0..1+). */
export function readPeaks(out: Float32Array): boolean {
	if (!analysers || !buffer) return false;
	for (let c = 0; c < 2; c++) {
		analysers[c].getFloatTimeDomainData(buffer);
		let peak = 0;
		for (let i = 0; i < buffer.length; i++) {
			const v = Math.abs(buffer[i]);
			if (v > peak) peak = v;
		}
		out[c] = peak;
	}
	return true;
}

/**
 * Meter deflection for a level in dBFS, 0..1 over -40..0 dB. Follows the IEC 60268-18 scale
 * (more resolution near 0 dB, like a hardware PPM), rescaled so -40 dB sits at the left edge.
 */
export function meterPosition(db: number): number {
	let iec: number;
	if (db < -40) iec = 15 + (db + 40) * 0.75;
	else if (db < -30) iec = 15 + (db + 40) * 1.5;
	else if (db < -20) iec = 30 + (db + 30) * 2;
	else iec = 50 + (db + 20) * 2.5;
	return Math.min(1, Math.max(0, (iec - 15) / 85));
}

export const METER_TICKS = [-40, -30, -20, -10, -6, -3, 0] as const;
