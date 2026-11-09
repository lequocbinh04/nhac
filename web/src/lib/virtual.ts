// Preact binding for @tanstack/virtual-core over the shell's scrolling <main>. Rows have a fixed
// height, so nothing is measured per item; only the list's offset inside the scroller is tracked.
import { Virtualizer, elementScroll, observeElementOffset, observeElementRect, type VirtualItem, type VirtualizerOptions } from "@tanstack/virtual-core";
import type { RefObject } from "preact";
import { useLayoutEffect, useReducer, useRef, useState } from "preact/hooks";
import { scrollElement } from "./router";

export interface VirtualList {
	items: VirtualItem[];
	total: number;
	/** Offset of the list's top inside the scroller; subtract from item.start for local positions */
	margin: number;
}

export function useVirtual(listRef: RefObject<HTMLElement | null>, count: number, size: number, overscan = 6): VirtualList {
	const [, rerender] = useReducer((n: number) => n + 1, 0);
	const [margin, setMargin] = useState(0);
	const sizeRef = useRef(size);

	const options = (): VirtualizerOptions<HTMLElement, HTMLElement> => ({
		count,
		getScrollElement: scrollElement,
		estimateSize: () => sizeRef.current,
		scrollToFn: elementScroll,
		observeElementRect,
		observeElementOffset,
		overscan,
		scrollMargin: margin,
		initialRect: { width: typeof innerWidth === "number" ? innerWidth : 1200, height: typeof innerHeight === "number" ? innerHeight : 800 },
		onChange: () => rerender(0),
	});
	const [v] = useState(() => new Virtualizer<HTMLElement, HTMLElement>(options()));
	v.setOptions(options());
	if (sizeRef.current !== size) {
		sizeRef.current = size;
		v.measure();
	}

	useLayoutEffect(() => v._didMount(), []);
	useLayoutEffect(() => {
		v._willUpdate();
	});

	// Track where the list starts inside the scroller (headers above it can change height).
	useLayoutEffect(() => {
		const list = listRef.current;
		const scroller = scrollElement();
		if (!list || !scroller) return;
		const measure = () => {
			const m = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
			setMargin((prev) => (Math.abs(prev - m) > 0.5 ? m : prev));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(scroller.firstElementChild ?? scroller);
		ro.observe(list);
		return () => ro.disconnect();
	}, []);

	return { items: v.getVirtualItems(), total: v.getTotalSize(), margin };
}
