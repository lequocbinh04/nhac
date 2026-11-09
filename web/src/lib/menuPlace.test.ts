import { describe, expect, it } from "vitest";
import { placeMenu } from "./menuPlace";

const W = 208;
const H = 200;

describe("placeMenu at a point", () => {
	it("puts the top-left corner at the pointer and scales from it", () => {
		expect(placeMenu({ x: 100, y: 120 }, W, H, 1440, 900)).toEqual({ left: 100, top: 120, originX: 0, originY: 0 });
	});

	it("flips left and up near the right and bottom edges, origin follows the pointer", () => {
		expect(placeMenu({ x: 1400, y: 850 }, W, H, 1440, 900)).toEqual({ left: 1400 - W, top: 850 - H, originX: W, originY: H });
	});

	it("clamps to the viewport when neither side fits", () => {
		const p = placeMenu({ x: 150, y: 150 }, W, H, 300, 260);
		expect(p.left).toBe(8);
		expect(p.top).toBe(8);
		expect(p.originX).toBe(142);
		expect(p.originY).toBe(150 - p.top);
	});

	it("keeps the origin inside the menu box", () => {
		const p = placeMenu({ x: 2, y: 2 }, W, H, 1440, 900);
		expect(p).toEqual({ left: 8, top: 8, originX: 0, originY: 0 });
	});
});

describe("placeMenu under a trigger", () => {
	const rect = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h, x: left, y: top });

	it("right-aligns below the trigger, origin at its center top", () => {
		expect(placeMenu(rect(500, 100, 44, 44), W, H, 1440, 900)).toEqual({ left: 544 - W, top: 150, originX: 522 - (544 - W), originY: 0 });
	});

	it("treats a DOMRect-like object (with x/y) as a trigger, not a point", () => {
		expect(placeMenu(rect(500, 100, 44, 44), W, H, 1440, 900).top).toBe(150);
	});

	it("flips above when it does not fit below", () => {
		const p = placeMenu(rect(500, 800, 44, 44), W, H, 1440, 900);
		expect(p.top).toBe(800 - 6 - H);
		expect(p.originY).toBe(H);
	});

	it("never leaves the left edge", () => {
		expect(placeMenu(rect(0, 100, 44, 44), W, H, 1440, 900).left).toBe(8);
	});
});
