// One popover menu at a time, anchored to its trigger and scaling from it. Context menus (right
// click, Shift+F10, the ContextMenu key) open the same menus at the pointer or at the focused row.
// Keyboard-opened menus appear without animation; arrow keys move focus instantly.
import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { placeMenu, type Point } from "../lib/menuPlace";

export interface MenuItem {
	label: string;
	onSelect: () => void;
	checked?: boolean;
}

interface MenuState {
	/** Gets focus back on close; carries aria-expanded when it is a menu button */
	anchor: HTMLElement;
	/** Where the menu goes: under an element, or at a pointer position */
	at: HTMLElement | Point;
	/** Opened as a context menu: any press outside the menu closes it, the anchor included */
	context: boolean;
	items: MenuItem[];
	label: string;
	instant: boolean;
	/** Radio-style menu (sort options) */
	radio?: boolean;
}

const menu = signal<MenuState | null>(null);

export function openMenu(e: MouseEvent, label: string, items: MenuItem[], radio = false) {
	const anchor = e.currentTarget as HTMLElement;
	if (menu.value?.anchor === anchor && !menu.value.context) {
		menu.value = null;
		return;
	}
	menu.value = { anchor, at: anchor, context: false, items, label, instant: e.detail === 0, radio };
}

/** Takes focus back on close: `focus()` when given, else `[data-menu-focus]` inside, else the target. */
function focusTarget(el: HTMLElement, focus?: () => HTMLElement | null): HTMLElement {
	return focus?.() ?? el.querySelector<HTMLElement>("[data-menu-focus]") ?? el;
}

/**
 * Handlers for a row, card or header whose right click (or Shift+F10 / ContextMenu key while focus
 * is inside it) opens the same menu as its ⋯ button. `get` is called at open time.
 */
export function contextMenu(get: () => { label: string; items: MenuItem[] } | null, focus?: () => HTMLElement | null) {
	return {
		onContextMenu(e: MouseEvent) {
			if (e.defaultPrevented) return;
			const m = get();
			if (!m) return;
			e.preventDefault();
			const el = e.currentTarget as HTMLElement;
			menu.value = { anchor: focusTarget(el, focus), at: { x: e.clientX, y: e.clientY }, context: true, ...m, instant: false };
		},
		onKeyDown(e: KeyboardEvent) {
			if (e.defaultPrevented || !(e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) return;
			const m = get();
			if (!m) return;
			e.preventDefault();
			const el = e.currentTarget as HTMLElement;
			const active = document.activeElement;
			const anchor = active instanceof HTMLElement && el.contains(active) ? active : focusTarget(el, focus);
			menu.value = { anchor, at: el, context: true, ...m, instant: true };
		},
	};
}

function close(focusAnchor: boolean) {
	const m = menu.value;
	menu.value = null;
	if (focusAnchor && m?.anchor.isConnected) m.anchor.focus({ preventScroll: true });
}

export function MenuHost() {
	const m = menu.value;
	const ref = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!m || !el) return;
		const at = m.at instanceof HTMLElement ? m.at.getBoundingClientRect() : m.at;
		const p = placeMenu(at, el.offsetWidth, el.offsetHeight, document.documentElement.clientWidth, window.innerHeight);
		el.style.left = `${p.left}px`;
		el.style.top = `${p.top}px`;
		el.style.transformOrigin = `${p.originX}px ${p.originY}px`;
		el.querySelector<HTMLElement>("[role^=menuitem]")?.focus({ preventScroll: true });
		if (!m.anchor.hasAttribute("aria-haspopup")) return;
		m.anchor.setAttribute("aria-expanded", "true");
		return () => m.anchor.setAttribute("aria-expanded", "false");
	}, [m]);

	useEffect(() => {
		if (!m) return;
		const onDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (ref.current?.contains(target) || (!m.context && m.anchor.contains(target))) return;
			close(false);
		};
		const onScroll = () => close(false);
		document.addEventListener("pointerdown", onDown, true);
		window.addEventListener("resize", onScroll);
		document.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("pointerdown", onDown, true);
			window.removeEventListener("resize", onScroll);
			document.removeEventListener("scroll", onScroll, true);
		};
	}, [m]);

	if (!m) return null;

	const onKeyDown = (e: KeyboardEvent) => {
		const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];
		const i = items.indexOf(document.activeElement as HTMLElement);
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			close(true);
		} else if (e.key === "Tab") {
			close(false);
		} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const n = items.length;
			items[(i + (e.key === "ArrowDown" ? 1 : -1) + n) % n]?.focus();
		} else if (e.key === "Home" || e.key === "End") {
			e.preventDefault();
			items[e.key === "Home" ? 0 : items.length - 1]?.focus();
		}
	};

	return (
		// onContextMenu: a right click in the menu, or the browser's own contextmenu event after
		// Shift+F10 / the ContextMenu key (fired at the focused item on keyup), shows no native menu.
		<div
			ref={ref}
			class="menu"
			role="menu"
			aria-label={m.label}
			data-instant={m.instant ? "" : undefined}
			onKeyDown={onKeyDown}
			onContextMenu={(e) => e.preventDefault()}
		>
			{m.items.map((item) => (
				<button
					key={item.label}
					type="button"
					class="menu-item"
					role={m.radio ? "menuitemradio" : "menuitem"}
					aria-checked={m.radio ? !!item.checked : undefined}
					tabIndex={-1}
					onClick={() => {
						close(true);
						item.onSelect();
					}}
				>
					<span>{item.label}</span>
					{m.radio && <span class="menu-check" aria-hidden="true" data-on={item.checked ? "" : undefined} />}
				</button>
			))}
		</div>
	);
}
