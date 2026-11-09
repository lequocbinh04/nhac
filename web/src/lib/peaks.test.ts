import { describe, expect, it } from "vitest";
import { decodePeaks, resamplePeaks } from "./peaks";

function b64(bytes: number[]): string {
	return btoa(String.fromCharCode(...bytes));
}

describe("decodePeaks", () => {
	it("decodes 96 unsigned bytes", () => {
		const bytes = Array.from({ length: 96 }, (_, i) => (i * 37) % 256);
		const out = decodePeaks(b64(bytes));
		expect(out).toBeInstanceOf(Uint8Array);
		expect(Array.from(out ?? [])).toEqual(bytes);
	});

	it("returns null for missing or malformed data instead of inventing a waveform", () => {
		expect(decodePeaks(undefined)).toBeNull();
		expect(decodePeaks("")).toBeNull();
		expect(decodePeaks("not base64 !!")).toBeNull();
	});
});

describe("resamplePeaks", () => {
	const peaks = new Uint8Array([0, 255, 51, 102]);
	const close = (actual: Float32Array, expected: number[]) => {
		expect(actual).toHaveLength(expected.length);
		expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 5));
	};

	it("keeps the loudest bin when downsampling", () => {
		close(resamplePeaks(peaks, 2), [1, 0.4]);
		close(resamplePeaks(peaks, 1), [1]);
	});

	it("is the identity at the same length", () => {
		close(resamplePeaks(peaks, 4), [0, 1, 0.2, 0.4]);
	});

	it("interpolates when upsampling, hitting the original bins at the ends", () => {
		const out = resamplePeaks(new Uint8Array([0, 255]), 5);
		expect(Array.from(out)).toEqual([0, 0.25, 0.5, 0.75, 1]);
	});

	it("handles empty input and zero bars", () => {
		expect(resamplePeaks(new Uint8Array(0), 10).every((v) => v === 0)).toBe(true);
		expect(resamplePeaks(peaks, 0)).toHaveLength(0);
	});
});
