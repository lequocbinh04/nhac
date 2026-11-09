// Waveform peaks: library.json carries an optional base64 string of unsigned bytes (0..255),
// one amplitude bin per slice of the track. The UI never invents data when it is missing.

/** Decode base64 peaks. Returns null for missing or malformed input. */
export function decodePeaks(b64: string | undefined | null): Uint8Array | null {
	if (!b64) return null;
	let bin: string;
	try {
		bin = atob(b64);
	} catch {
		return null;
	}
	if (bin.length === 0) return null;
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * Resample bins to `count` bars, values 0..1. Downsampling keeps the loudest bin in each bucket
 * (so transients stay visible); upsampling interpolates linearly between neighbouring bins.
 */
export function resamplePeaks(peaks: Uint8Array, count: number): Float32Array {
	const out = new Float32Array(Math.max(0, count));
	const n = peaks.length;
	if (n === 0 || count <= 0) return out;
	if (count <= n) {
		for (let i = 0; i < count; i++) {
			const from = Math.floor((i * n) / count);
			const to = Math.max(from + 1, Math.floor(((i + 1) * n) / count));
			let max = 0;
			for (let j = from; j < to; j++) if (peaks[j] > max) max = peaks[j];
			out[i] = max / 255;
		}
		return out;
	}
	for (let i = 0; i < count; i++) {
		const pos = count === 1 ? 0 : (i * (n - 1)) / (count - 1);
		const lo = Math.floor(pos);
		const hi = Math.min(n - 1, lo + 1);
		const f = pos - lo;
		out[i] = (peaks[lo] * (1 - f) + peaks[hi] * f) / 255;
	}
	return out;
}
