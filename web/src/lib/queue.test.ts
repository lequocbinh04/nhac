import { describe, expect, it } from "vitest";
import {
	append,
	clearUpcoming,
	currentId,
	cycleRepeat,
	emptyQueue,
	move,
	nextIndex,
	playNext,
	prevAction,
	removeAt,
	replaceQueue,
	sanitize,
	setShuffle,
	shuffleKeepCurrent,
	type QueueState,
} from "./queue";

const ids = ["a", "b", "c", "d", "e"];

/** Deterministic PRNG (mulberry32) so shuffles are reproducible. */
function seeded(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function at(s: QueueState, index: number): QueueState {
	return { ...s, index };
}

describe("shuffle", () => {
	it("keeps the current track first and permutes the rest", () => {
		const out = shuffleKeepCurrent(ids, 2, seeded(1));
		expect(out[0]).toBe("c");
		expect([...out].sort()).toEqual(ids);
	});

	it("produces every permutation of the rest with a uniform-ish distribution", () => {
		const rand = seeded(42);
		const counts = new Map<string, number>();
		for (let i = 0; i < 6000; i++) {
			const k = shuffleKeepCurrent(["x", "1", "2", "3"], 0, rand).join("");
			counts.set(k, (counts.get(k) ?? 0) + 1);
		}
		expect(counts.size).toBe(6);
		for (const n of counts.values()) expect(n).toBeGreaterThan(800);
	});

	it("turning shuffle off restores the original order at the current track", () => {
		const q = replaceQueue(emptyQueue, ids, 1, false);
		const on = setShuffle(q, true, seeded(7));
		expect(on.index).toBe(0);
		expect(currentId(on)).toBe("b");
		const moved = at(on, 3);
		const cur = currentId(moved);
		const off = setShuffle(moved, false);
		expect(off.items).toEqual(ids);
		expect(currentId(off)).toBe(cur);
		expect(off.original).toBeNull();
	});

	it("replaceQueue with shuffle starts on the chosen track", () => {
		const q = replaceQueue(emptyQueue, ids, 3, true, seeded(3));
		expect(currentId(q)).toBe("d");
		expect(q.original).toEqual(ids);
	});
});

describe("next / repeat", () => {
	const q = replaceQueue(emptyQueue, ids, 0, false);

	it("advances and stops at the end with repeat off", () => {
		expect(nextIndex(q, true)).toBe(1);
		expect(nextIndex(at(q, 4), true)).toBeNull();
		expect(nextIndex(at(q, 4), false)).toBeNull();
	});

	it("wraps with repeat all", () => {
		expect(nextIndex({ ...at(q, 4), repeat: "all" }, true)).toBe(0);
	});

	it("repeat one replays on track end but manual next moves on", () => {
		const one = { ...at(q, 2), repeat: "one" as const };
		expect(nextIndex(one, true)).toBe(2);
		expect(nextIndex(one, false)).toBe(3);
	});

	it("cycles off -> all -> one -> off", () => {
		expect(cycleRepeat("off")).toBe("all");
		expect(cycleRepeat("all")).toBe("one");
		expect(cycleRepeat("one")).toBe("off");
	});

	it("an empty queue has nothing next", () => {
		expect(nextIndex(emptyQueue, true)).toBeNull();
	});
});

describe("previous", () => {
	const q = at(replaceQueue(emptyQueue, ids, 0, false), 2);

	it("restarts the track when more than 3 seconds in", () => {
		expect(prevAction(q, 3.5)).toEqual({ index: 2, restart: true });
	});

	it("goes to the previous track within the first 3 seconds", () => {
		expect(prevAction(q, 2.9)).toEqual({ index: 1, restart: false });
		expect(prevAction(q, 3)).toEqual({ index: 1, restart: false });
	});

	it("restarts the first track, or wraps to the last with repeat all", () => {
		expect(prevAction(at(q, 0), 1)).toEqual({ index: 0, restart: true });
		expect(prevAction({ ...at(q, 0), repeat: "all" }, 1)).toEqual({ index: 4, restart: false });
	});
});

describe("editing", () => {
	const q = at(replaceQueue(emptyQueue, ids, 0, false), 2);

	it("removing before the current track keeps playing the same track", () => {
		const r = removeAt(q, 0);
		expect(r.items).toEqual(["b", "c", "d", "e"]);
		expect(currentId(r)).toBe("c");
	});

	it("removing the current track makes the next one current", () => {
		expect(currentId(removeAt(q, 2))).toBe("d");
		expect(currentId(removeAt(at(q, 4), 4))).toBe("d");
		expect(removeAt(replaceQueue(emptyQueue, ["a"], 0, false), 0)).toMatchObject({ items: [], index: -1 });
	});

	it("removing also removes from the pre-shuffle order", () => {
		const s = setShuffle(q, true, seeded(5));
		const i = s.items.indexOf("e");
		const off = setShuffle(removeAt(s, i), false);
		expect(off.items).toEqual(["a", "b", "c", "d"]);
		expect(currentId(off)).toBe("c");
	});

	it("moving keeps the current track current", () => {
		const m = move(q, 4, 0);
		expect(m.items).toEqual(["e", "a", "b", "c", "d"]);
		expect(currentId(m)).toBe("c");
		const m2 = move(q, 2, 4);
		expect(m2.items).toEqual(["a", "b", "d", "e", "c"]);
		expect(m2.index).toBe(4);
		expect(move(q, 1, 9)).toBe(q);
	});

	it("play next inserts after the current track without duplicates", () => {
		const p = playNext(q, ["e", "a"]);
		expect(p.items).toEqual(["b", "c", "e", "a", "d"]);
		expect(currentId(p)).toBe("c");
		expect(playNext(emptyQueue, ["x", "y"])).toMatchObject({ items: ["x", "y"], index: 0 });
	});

	it("append moves existing ids to the end and never moves the current track", () => {
		const p = append(q, ["a", "c", "z"]);
		expect(p.items).toEqual(["b", "c", "d", "e", "a", "z"]);
		expect(currentId(p)).toBe("c");
	});

	it("clear keeps only the current track", () => {
		expect(clearUpcoming(q)).toMatchObject({ items: ["c"], index: 0 });
		expect(clearUpcoming(emptyQueue)).toMatchObject({ items: [], index: -1 });
	});

	it("sanitize drops unknown ids and keeps a sensible index", () => {
		const s = sanitize(q, (id) => id !== "a");
		expect(s.items).toEqual(["b", "c", "d", "e"]);
		expect(currentId(s)).toBe("c");
		const gone = sanitize(q, (id) => id !== "c");
		expect(gone.index).toBe(2);
		expect(currentId(gone)).toBe("d");
	});
});
