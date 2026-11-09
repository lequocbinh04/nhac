import { describe, expect, it } from "vitest";
import { PRELOAD_LEAD_S, preloadFor, shouldPreloadNext, type PreloadState } from "./playback";

const playingNearEnd: PreloadState = { playing: true, paused: false, readyState: 4, remaining: 20, hasNext: true, alreadyPreloaded: false };

describe("restore and paused loads", () => {
	it("do not touch the network until play", () => {
		expect(preloadFor(false)).toBe("none");
		expect(preloadFor(true)).toBe("auto");
	});
});

describe("shouldPreloadNext", () => {
	it("buffers the next track near the end of a playing track", () => {
		expect(shouldPreloadNext(playingNearEnd)).toBe(true);
		expect(shouldPreloadNext({ ...playingNearEnd, remaining: PRELOAD_LEAD_S })).toBe(true);
	});

	it("waits until the end is near", () => {
		expect(shouldPreloadNext({ ...playingNearEnd, remaining: PRELOAD_LEAD_S + 1 })).toBe(false);
	});

	it("never preloads after a reload restore of a short track (paused, no data yet)", () => {
		// A 39 s intro restored at 10 s is inside the lead window but must stay quiet.
		expect(shouldPreloadNext({ ...playingNearEnd, playing: false, paused: true, readyState: 0, remaining: 29 })).toBe(false);
	});

	it("waits until the current track can actually play", () => {
		expect(shouldPreloadNext({ ...playingNearEnd, readyState: 1 })).toBe(false);
		expect(shouldPreloadNext({ ...playingNearEnd, readyState: 2 })).toBe(false);
		expect(shouldPreloadNext({ ...playingNearEnd, readyState: 3 })).toBe(true);
	});

	it("skips when paused, already buffered, nothing next, or the duration is unknown", () => {
		expect(shouldPreloadNext({ ...playingNearEnd, paused: true })).toBe(false);
		expect(shouldPreloadNext({ ...playingNearEnd, alreadyPreloaded: true })).toBe(false);
		expect(shouldPreloadNext({ ...playingNearEnd, hasNext: false })).toBe(false);
		expect(shouldPreloadNext({ ...playingNearEnd, remaining: Number.NaN })).toBe(false);
		expect(shouldPreloadNext({ ...playingNearEnd, remaining: 0 })).toBe(false);
	});
});
