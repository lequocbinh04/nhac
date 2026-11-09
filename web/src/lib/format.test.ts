import { describe, expect, it } from "vitest";
import { codecLabel, formatBytes, formatRate, formatTime, isLossless, qualityParts, shortSpec, streamUrl, summarize, trackSpec } from "./format";

describe("formatTime", () => {
	it("formats minutes and hours", () => {
		expect(formatTime(0)).toBe("0:00");
		expect(formatTime(9.99)).toBe("0:09");
		expect(formatTime(192)).toBe("3:12");
		expect(formatTime(1924)).toBe("32:04");
		expect(formatTime(3725)).toBe("1:02:05");
	});

	it("never prints garbage for invalid input", () => {
		expect(formatTime(Number.NaN)).toBe("0:00");
		expect(formatTime(-5)).toBe("0:00");
		expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
	});
});

describe("specs", () => {
	it("labels codecs", () => {
		expect(codecLabel("flac")).toBe("FLAC");
		expect(codecLabel("pcm_s24le")).toBe("WAV");
		expect(codecLabel("alac")).toBe("ALAC");
		expect(codecLabel("dsd_lsbf")).toBe("DSD_LSBF");
		expect(isLossless("pcm_s16le")).toBe(true);
		expect(isLossless("aac")).toBe(false);
	});

	it("formats sample rates in kHz", () => {
		expect(formatRate(44100)).toBe("44.1");
		expect(formatRate(48000)).toBe("48");
		expect(formatRate(176400)).toBe("176.4");
		expect(formatRate(192000)).toBe("192");
	});

	it("formats a track spec, lossy tracks by codec", () => {
		expect(trackSpec({ bits: 24, sr: 192000, codec: "flac" })).toBe("24/192");
		expect(trackSpec({ bits: 0, sr: 44100, codec: "mp3" })).toBe("MP3");
		expect(qualityParts({ bits: 24, sr: 96000, codec: "flac" })).toEqual({ codec: "FLAC", bits: 24, khz: "96" });
		expect(qualityParts({ bits: 0, sr: 44100, codec: "aac" })).toEqual({ codec: "AAC", bits: null, khz: "44.1" });
	});

	it("summarizes an album: uniform, mixed and lossy", () => {
		const t = (bits: number, sr: number, codec = "flac", dur = 60) => ({ bits, sr, codec, dur });
		const uniform = summarize([t(24, 48000), t(24, 48000, "flac", 30.5)]);
		expect(uniform).toMatchObject({ codec: "FLAC", spec: "24/48", hiRes: true, cd: false, seconds: 90.5 });
		const cd = summarize([t(16, 44100), t(16, 44100)]);
		expect(cd).toMatchObject({ spec: "16/44.1", hiRes: false, cd: true });
		const mixed = summarize([t(16, 44100), t(24, 48000), t(0, 44100, "mp3")]);
		expect(mixed).toMatchObject({ codec: "FLAC/MP3", spec: "16–24/44.1–48", hiRes: true, cd: false });
		const lossy = summarize([t(0, 44100, "aac")]);
		expect(shortSpec(lossy)).toBe("AAC");
		expect(summarize([]).cd).toBe(false);
	});
});

describe("formatBytes", () => {
	it("uses decimal units and the locale's separator", () => {
		expect(formatBytes(43025713290, "vi")).toBe("43,0 GB");
		expect(formatBytes(43025713290, "en")).toBe("43.0 GB");
		expect(formatBytes(512, "en")).toBe("512 B");
		expect(formatBytes(150_000_000, "en")).toBe("150 MB");
	});
});

describe("streamUrl", () => {
	it("encodes each path segment but keeps slashes", () => {
		expect(streamUrl("Tiệm Mưa/Mưa Vàng Trên Phố/03 - mưa rơi.flac")).toBe(
			"/stream/Ti%E1%BB%87m%20M%C6%B0a/M%C6%B0a%20V%C3%A0ng%20Tr%C3%AAn%20Ph%E1%BB%91/03%20-%20m%C6%B0a%20r%C6%A1i.flac",
		);
		expect(streamUrl("a#b?c/100%.flac")).toBe("/stream/a%23b%3Fc/100%25.flac");
	});
});
