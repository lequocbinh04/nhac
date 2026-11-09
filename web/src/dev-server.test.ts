import { describe, expect, it } from "vitest";
import { parseRange, streamKey } from "../dev-server";

describe("dev server stream keys", () => {
	it("decodes each segment and keeps slashes", () => {
		expect(streamKey("/stream/Ti%E1%BB%87m%20M%C6%B0a/M%C6%B0a%20V%C3%A0ng/03%20-%20m%C6%B0a.flac")).toBe("Tiệm Mưa/Mưa Vàng/03 - mưa.flac");
		expect(streamKey("/stream/a%2Fb.flac")).toBe("a/b.flac");
	});

	it("rejects traversal and malformed input", () => {
		expect(streamKey("/stream/../secret")).toBeNull();
		expect(streamKey("/stream/a/%2E%2E/b")).toBeNull();
		expect(streamKey("/stream/a//b")).toBeNull();
		expect(streamKey("/stream/%E0%A4%A")).toBeNull();
	});
});

describe("dev server ranges", () => {
	it("parses open, closed and suffix ranges", () => {
		expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
		expect(parseRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
		expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
		expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
		expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
	});

	it("flags unsatisfiable ranges and ignores what it cannot parse", () => {
		expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
		expect(parseRange("bytes=500-100", 1000)).toBe("unsatisfiable");
		expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
		expect(parseRange(undefined, 1000)).toBeNull();
		expect(parseRange("items=0-1", 1000)).toBeNull();
		expect(parseRange("bytes=0-1,5-6", 1000)).toBeNull();
	});
});
