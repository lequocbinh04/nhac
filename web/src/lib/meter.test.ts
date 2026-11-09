import { describe, expect, it } from "vitest";
import { meterPosition } from "./meter";

describe("meterPosition", () => {
	it("maps -40..0 dBFS onto 0..1 with more resolution near full scale", () => {
		expect(meterPosition(-40)).toBe(0);
		expect(meterPosition(0)).toBe(1);
		expect(meterPosition(-20)).toBeCloseTo(35 / 85, 6);
		expect(meterPosition(-10)).toBeCloseTo(60 / 85, 6);
		// Per dB, the top of the scale is wider than the bottom.
		expect((meterPosition(0) - meterPosition(-3)) / 3).toBeGreaterThan((meterPosition(-30) - meterPosition(-40)) / 10);
	});

	it("is monotonic and clamped", () => {
		let prev = -1;
		for (let db = -80; db <= 6; db += 0.5) {
			const p = meterPosition(db);
			expect(p).toBeGreaterThanOrEqual(prev);
			prev = p;
		}
		expect(meterPosition(-Infinity)).toBe(0);
		expect(meterPosition(6)).toBe(1);
	});
});
