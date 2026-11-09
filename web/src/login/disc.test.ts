import { describe, expect, it } from "vitest";
import { labelText } from "./disc";

const LONG = "NHẠC · LOSSLESS · 24-BIT / 192 KHZ · ";
// 10.5px JetBrains Mono: 0.6em advance per glyph.
const advance = 10.5 * 0.6;
const length = (r: { text: string; tracking: number }) => [...r.text].length * (advance + r.tracking);

describe("labelText", () => {
	it("repeats the long label as many whole times as the ring holds and closes the circle exactly", () => {
		const C = 2 * Math.PI * 89.6;
		const ring = labelText(C);
		expect(ring.text).toBe(LONG.repeat(2));
		expect(length(ring)).toBeCloseTo(C, 6);
		expect(ring.tracking).toBeGreaterThanOrEqual(10.5 * 0.08);
	});

	it("keeps one full long label on phone-sized rings", () => {
		const C = 2 * Math.PI * 47;
		const ring = labelText(C);
		expect(ring.text).toBe(LONG);
		expect(length(ring)).toBeCloseTo(C, 6);
	});

	it("prefers more short labels over one widely tracked long label", () => {
		const C = 400;
		const ring = labelText(C);
		expect(ring.text).toBe("NHẠC · LOSSLESS · 24/192 · ".repeat(2));
		expect(ring.tracking).toBeLessThanOrEqual(10.5 * 0.3);
		expect(length(ring)).toBeCloseTo(C, 6);
	});

	it("falls back to the short label when the long one cannot fit", () => {
		const ring = labelText(2 * Math.PI * 30);
		expect(ring.text).toContain("24/192");
		expect(ring.text).not.toContain("KHZ");
		expect(ring.tracking).toBeGreaterThanOrEqual(0);
	});
});
