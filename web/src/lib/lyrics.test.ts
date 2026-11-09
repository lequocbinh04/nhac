import { describe, expect, it } from "vitest";
import { activeIndex, lyricRows, parseLrc, parseLyrics, parsePlain } from "./lyrics";

describe("parseLrc", () => {
	it("reads mm:ss with 0-3 fraction digits", () => {
		const lines = parseLrc("[00:01]a\n[00:02.5]b\n[00:03.25]c\n[00:04.125]d\n[01:05:30]e");
		expect(lines).toEqual([
			{ time: 1, text: "a" },
			{ time: 2.5, text: "b" },
			{ time: 3.25, text: "c" },
			{ time: 4.125, text: "d" },
			{ time: 65.3, text: "e" },
		]);
	});

	it("expands several timestamps on one line and sorts by time, stable", () => {
		const lines = parseLrc("[00:30.00][00:10.00]Mưa vàng trên phố\n[00:20.00]Đêm Sài Gòn\n[00:10.00]cùng lúc");
		expect(lines?.map((l) => `${l.time} ${l.text}`)).toEqual(["10 Mưa vàng trên phố", "10 cùng lúc", "20 Đêm Sài Gòn", "30 Mưa vàng trên phố"]);
	});

	it("ignores metadata, applies [offset] (positive = earlier), never below zero", () => {
		const lines = parseLrc("[ar:Tiệm Mưa]\n[ti:Quán Khuya]\n[al:Đêm Sài Gòn]\n[by:someone]\n[length:03:20]\n[offset:+500]\n[00:00.20]first\n[00:10.00]second");
		expect(lines).toEqual([
			{ time: 0, text: "first" },
			{ time: 9.5, text: "second" },
		]);
		expect(parseLrc("[offset:-250]\n[00:01.00]x")).toEqual([{ time: 1.25, text: "x" }]);
	});

	it("strips enhanced word timings and extra spaces", () => {
		expect(parseLrc("[00:05.00]<00:05.00>Hạ <00:05.40>Vy   <00:06.10>hát")).toEqual([{ time: 5, text: "Hạ Vy hát" }]);
	});

	it("keeps blank timed lines as instrumental gaps, handles BOM and CRLF", () => {
		expect(parseLrc("\uFEFF[00:01.00]a\r\n[00:04.00]\r\n[00:12.00]b")).toEqual([
			{ time: 1, text: "a" },
			{ time: 4, text: "" },
			{ time: 12, text: "b" },
		]);
	});

	it("returns null when nothing is timed", () => {
		expect(parseLrc("just words\nmore words")).toBeNull();
		expect(parseLrc("[ar:Ferro & Lune]\n")).toBeNull();
	});
});

describe("parseLyrics", () => {
	it("is synced for LRC, plain otherwise or when the library says plain", () => {
		expect(parseLyrics("[00:01.00]a").kind).toBe("synced");
		expect(parseLyrics("a\nb")).toEqual({ kind: "plain", lines: ["a", "b"] });
		expect(parseLyrics("[00:01.00]a", "plain")).toEqual({ kind: "plain", lines: ["a"] });
		// Timestamps with no text at all are not useful as synced lyrics.
		expect(parseLyrics("[00:01.00]\n[00:02.00]").kind).toBe("plain");
	});

	it("plain text keeps single stanza breaks and drops tags", () => {
		expect(parsePlain("[ti:Quán Khuya]\nmột\n\n\n\nhai\n  ba  \n\n")).toEqual(["một", "", "hai", "ba"]);
	});
});

describe("activeIndex", () => {
	const lines = [
		{ time: 5, text: "a" },
		{ time: 10, text: "b" },
		{ time: 10, text: "c" },
		{ time: 20, text: "d" },
	];

	it("finds the last line that started at or before t", () => {
		expect(activeIndex(lines, 0)).toBe(-1);
		expect(activeIndex(lines, 4.99)).toBe(-1);
		expect(activeIndex(lines, 5)).toBe(0);
		expect(activeIndex(lines, 9.9)).toBe(0);
		expect(activeIndex(lines, 10)).toBe(2);
		expect(activeIndex(lines, 19)).toBe(2);
		expect(activeIndex(lines, 500)).toBe(3);
		expect(activeIndex([], 3)).toBe(-1);
	});

	it("agrees with a linear scan on a long list", () => {
		const long = Array.from({ length: 500 }, (_, i) => ({ time: i * 1.7, text: String(i) }));
		for (let t = -1; t < 900; t += 3.3) {
			let expected = -1;
			long.forEach((l, i) => {
				if (l.time <= t) expected = i;
			});
			expect(activeIndex(long, t)).toBe(expected);
		}
	});
});

describe("lyricRows", () => {
	it("adds an intro gap, collapses repeated blanks and flags long gaps only", () => {
		const rows = lyricRows(
			[
				{ time: 8, text: "a" },
				{ time: 12, text: "" },
				{ time: 13, text: "" },
				{ time: 15, text: "b" },
				{ time: 20, text: "" },
				{ time: 40, text: "c" },
			],
			60,
		);
		expect(rows.map((r) => [r.time, r.text, r.longGap])).toEqual([
			[0, "", true],
			[8, "a", false],
			[12, "", false],
			[15, "b", false],
			[20, "", true],
			[40, "c", false],
		]);
	});

	it("flags a trailing gap by the track duration", () => {
		const rows = lyricRows(
			[
				{ time: 1, text: "a" },
				{ time: 50, text: "" },
			],
			58,
		);
		expect(rows[1].longGap).toBe(true);
		expect(lyricRows([{ time: 1, text: "a" }], 58)).toHaveLength(1);
	});
});
