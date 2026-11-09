import { describe, expect, it } from "vitest";
import { dicts } from "./i18n";
import { describeQuality, formatKhz, freqTicks, isSuspect, qualityCounts, timeTicks, verdictOf } from "./quality";
import type { TrackQuality } from "./types";

const { vi, en } = dicts;
const q = (o: Partial<TrackQuality> & Pick<TrackQuality, "verdict">): TrackQuality => ({ cutoffHz: 0, confidence: 0.9, ...o });

describe("formatKhz", () => {
	it("drops trailing zeros and rounds", () => {
		expect(formatKhz(16000)).toBe("16");
		expect(formatKhz(15840)).toBe("15.8");
		expect(formatKhz(22050, 2)).toBe("22.05");
		expect(formatKhz(48000, 2)).toBe("48");
	});
});

describe("freqTicks", () => {
	it("44.1 kHz: 5 kHz steps, exact Nyquist on top, 20k kept", () => {
		const t = freqTicks(22050);
		expect(t.map((x) => x.label)).toEqual(["0", "5", "10", "15", "20", "22.05"]);
		expect(t[0].at).toBe(0);
		expect(t.at(-1)).toEqual({ at: 1, label: "22.05", edge: true });
		expect(t[1].at).toBeCloseTo(5000 / 22050);
	});

	it("drops a round tick that would crowd the Nyquist label", () => {
		// 40k sits at 95% of a 42 kHz axis, too close to the "42" edge label.
		expect(freqTicks(42000).map((x) => x.label)).toEqual(["0", "10", "20", "30", "42"]);
	});

	it("hi-res rates use wider steps", () => {
		expect(freqTicks(48000).map((x) => x.label)).toEqual(["0", "10", "20", "30", "40", "48"]);
		expect(freqTicks(96000).map((x) => x.label)).toEqual(["0", "20", "40", "60", "80", "96"]);
		expect(freqTicks(8000).map((x) => x.label)).toEqual(["0", "2", "4", "6", "8"]);
	});

	it("is empty for a missing rate", () => {
		expect(freqTicks(0)).toEqual([]);
		expect(freqTicks(Number.NaN)).toEqual([]);
	});
});

describe("timeTicks", () => {
	it("picks a round step with at most six intervals", () => {
		expect(timeTicks(215).map((x) => x.label)).toEqual(["0:00", "1:00", "2:00", "3:00"]);
		expect(timeTicks(25).map((x) => x.label)).toEqual(["0:00", "0:05", "0:10", "0:15", "0:20"]);
		expect(timeTicks(3725).map((x) => x.label)).toEqual(["0:00", "15:00", "30:00", "45:00"]);
	});

	it("leaves out a tick right at the end", () => {
		expect(timeTicks(182).map((x) => x.label)).toEqual(["0:00", "1:00", "2:00"]);
		expect(timeTicks(178).map((x) => x.label)).toEqual(["0:00", "0:30", "1:00", "1:30", "2:00", "2:30"]);
		expect(timeTicks(121).map((x) => x.label)).toEqual(["0:00", "0:30", "1:00", "1:30"]);
	});

	it("positions are fractions of the duration", () => {
		expect(timeTicks(240)[1].at).toBe(0.25);
		expect(timeTicks(0)).toEqual([]);
	});
});

describe("verdicts", () => {
	it("never accuses with low confidence", () => {
		expect(verdictOf(q({ verdict: "lossy", confidence: 0.69 }))).toBe("unknown");
		expect(verdictOf(q({ verdict: "upsampled", confidence: 0.7 }))).toBe("upsampled");
		expect(verdictOf(q({ verdict: "lossless", confidence: 0.2 }))).toBe("lossless");
		expect(verdictOf(undefined)).toBeNull();
		expect(isSuspect({ quality: q({ verdict: "lossy" }) })).toBe(true);
		expect(isSuspect({ quality: q({ verdict: "lossy", confidence: 0.5 }) })).toBe(false);
		expect(isSuspect({})).toBe(false);
	});

	it("counts per verdict", () => {
		const c = qualityCounts([{ quality: q({ verdict: "lossless" }) }, { quality: q({ verdict: "lossy", confidence: 0.1 }) }, {}]);
		expect(c).toEqual({ lossless: 1, upsampled: 0, lossy: 0, unknown: 1, none: 1 });
	});
});

describe("describeQuality", () => {
	const track = { sr: 44100, bits: 16 };

	it("is null when not analysed", () => {
		expect(describeQuality(track, en)).toBeNull();
	});

	it("lossless: energy up to the cutoff", () => {
		const d = describeQuality({ ...track, quality: q({ verdict: "lossless", cutoffHz: 21800 }) }, vi);
		expect(d).toEqual({ verdict: "lossless", label: "Lossless", detail: null, why: "Năng lượng tới 21.8 kHz, không có vết cắt → lossless thật" });
	});

	it("lossy: brickwall and source", () => {
		const d = describeQuality({ ...track, quality: q({ verdict: "lossy", cutoffHz: 16000, source: "MP3/AAC" }) }, vi);
		expect(d?.label).toBe("Nguồn nén");
		expect(d?.detail).toBe("~16 kHz");
		expect(d?.why).toBe("Cắt gắt ở 16 kHz → nguồn MP3/AAC");
		expect(describeQuality({ ...track, quality: q({ verdict: "lossy", cutoffHz: 19600 }) }, en)?.why).toBe("Brickwall at 19.6 kHz → MP3/AAC source");
	});

	it("upsampled rate: names the source rate", () => {
		const hi = { sr: 96000, bits: 24 };
		const d = describeQuality({ ...hi, quality: q({ verdict: "upsampled", cutoffHz: 21900, source: "44.1k" }) }, vi);
		expect(d?.label).toBe("Nâng mẫu");
		expect(d?.detail).toBe("nguồn 44.1k");
		expect(d?.why).toBe("Không có gì trên 21.9 kHz dù tệp 96 kHz → nguồn 44.1k");
		expect(describeQuality({ ...hi, quality: q({ verdict: "upsampled", cutoffHz: 21900, source: "44.1/48k/16-bit" }) }, en)?.detail).toBe("44.1/48k/16-bit source");
	});

	it("upsampled bits: empty low bits", () => {
		const d = describeQuality({ sr: 44100, bits: 24, quality: q({ verdict: "upsampled", cutoffHz: 21000, effectiveBits: 16, source: "16-bit" }) }, en);
		expect(d?.detail).toBe("16-bit source");
		expect(d?.why).toBe("24-bit file with empty low bits → 16-bit source");
	});

	it("upsampled without a source token derives one", () => {
		expect(describeQuality({ sr: 44100, bits: 24, quality: q({ verdict: "upsampled", cutoffHz: 21000, effectiveBits: 16 }) }, en)?.detail).toBe("16-bit source");
		expect(describeQuality({ sr: 96000, bits: 24, quality: q({ verdict: "upsampled", cutoffHz: 22000 }) }, en)?.detail).toBe("44.1/48k source");
	});

	it("low-confidence accusation reads as inconclusive", () => {
		const d = describeQuality({ ...track, quality: q({ verdict: "lossy", cutoffHz: 16000, confidence: 0.4 }) }, en);
		expect(d).toEqual({ verdict: "unknown", label: "Inconclusive", detail: null, why: "Energy up to 16 kHz, not enough to call it" });
	});
});
