// Where a popover menu goes: under (or above) its trigger, or at the pointer for context menus.
// Pure so the clamping is testable; the menu host measures and applies the result.

export interface Rect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface Placement {
	left: number;
	top: number;
	/** transform-origin inside the menu, so it scales from the trigger or the pointer */
	originX: number;
	originY: number;
}

const GAP = 6;
export const EDGE = 8;

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/**
 * Trigger anchor: right-aligned under the trigger, flipped above when it does not fit below.
 * Point anchor: the top-left corner at the pointer, flipped left/up when it would overflow, then
 * clamped to the viewport. The origin is the anchor point expressed inside the menu box.
 */
export function placeMenu(anchor: Rect | Point, w: number, h: number, vw: number, vh: number): Placement {
	// DOMRect also has x/y, so tell the two apart by `right`.
	if (!("right" in anchor)) {
		const left = clamp(anchor.x + w > vw - EDGE ? anchor.x - w : anchor.x, EDGE, vw - w - EDGE);
		const top = clamp(anchor.y + h > vh - EDGE ? anchor.y - h : anchor.y, EDGE, vh - h - EDGE);
		return { left, top, originX: clamp(anchor.x - left, 0, w), originY: clamp(anchor.y - top, 0, h) };
	}
	const below = anchor.bottom + GAP + h <= vh - EDGE || anchor.top - GAP - h < EDGE;
	const left = clamp(anchor.right - w, EDGE, vw - w - EDGE);
	const top = below ? anchor.bottom + GAP : anchor.top - GAP - h;
	return { left, top, originX: clamp((anchor.left + anchor.right) / 2 - left, 0, w), originY: below ? 0 : h };
}
