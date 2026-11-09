import { describe, expect, it } from "vitest";
import { albumPath, loginPath, parseStart, trackPath } from "./links";

describe("share paths", () => {
	it("links a track, adding ?t= only past the first 5 seconds", () => {
		expect(trackPath("cab1c0eb75c7")).toBe("/track/cab1c0eb75c7");
		expect(trackPath("cab1c0eb75c7", 5)).toBe("/track/cab1c0eb75c7");
		expect(trackPath("cab1c0eb75c7", 5.4)).toBe("/track/cab1c0eb75c7?t=5");
		expect(trackPath("cab1c0eb75c7", 83.9)).toBe("/track/cab1c0eb75c7?t=83");
		expect(trackPath("cab1c0eb75c7", Number.NaN)).toBe("/track/cab1c0eb75c7");
	});

	it("encodes ids", () => {
		expect(trackPath("a/b c")).toBe("/track/a%2Fb%20c");
		expect(albumPath("76039e92c766")).toBe("/albums/76039e92c766");
	});
});

describe("parseStart", () => {
	it("reads seconds and clock notation", () => {
		expect(parseStart("90", 300)).toBe(90);
		expect(parseStart("90.7", 300)).toBe(90);
		expect(parseStart("1:30", 300)).toBe(90);
		expect(parseStart("1:02:03", 4000)).toBe(3723);
	});

	it("clamps to the track and ignores junk", () => {
		expect(parseStart("999", 192)).toBe(191);
		expect(parseStart("-5", 192)).toBe(0);
		expect(parseStart("abc", 192)).toBe(0);
		expect(parseStart("1:75", 192)).toBe(0);
		expect(parseStart(null, 192)).toBe(0);
		expect(parseStart("", 192)).toBe(0);
		expect(parseStart("30", 0)).toBe(0);
	});
});

describe("loginPath", () => {
	it("brings the user back to where they were", () => {
		expect(loginPath("/track/cab1c0eb75c7", "?t=83")).toBe("/login?next=%2Ftrack%2Fcab1c0eb75c7%3Ft%3D83");
		expect(loginPath("/albums/76039e92c766", "")).toBe("/login?next=%2Falbums%2F76039e92c766");
	});

	it("skips next for the home page and never loops through /login", () => {
		expect(loginPath("/", "")).toBe("/login");
		expect(loginPath("/login", "?next=%2Fx")).toBe("/login");
	});

	it("keeps the home page's query when there is one", () => {
		expect(loginPath("/", "?q=1")).toBe("/login?next=%2F%3Fq%3D1");
	});
});
