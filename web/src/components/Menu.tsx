// One popover menu at a time, anchored to its trigger and scaling from it. Keyboard-opened menus
// appear without animation; arrow keys move focus instantly.
import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

export interface MenuItem {
	label: string;
	onSelect: () => void;
	checked?: boolean;
}

interface MenuState {
	anchor: HTMLElement;
	items: MenuItem[];
	label: string;
	instant: boolean;
	/** Radio-style menu (sort options) */
	radio?: boolean;
}

const menu = signal<MenuState | null>(null);

export function openMenu(e: MouseEvent, label: string, items: MenuItem[], radio = false) {
	const anchor = e.currentTarget as HTMLElement;
	if (menu.value?.anchor === anchor) {
		menu.value = null;
		return;
	}
	menu.value = { anchor, items, label, instant: e.detail === 0, radio };
}

function close(focusAnchor: boolean) {
	const m = menu.value;
	menu.value = null;
	if (focusAnchor && m?.anchor.isConnected) m.anchor.focus();
}

export function MenuHost() {
	const m = menu.value;
	const ref = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!m || !el) return;
		const r = m.anchor.getBoundingClientRect();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const vw = document.documentElement.clientWidth;
		const vh = window.innerHeight;
		const below = r.bottom + 6 + h <= vh - 8 || r.top - 6 - h < 8;
		const left = Math.min(Math.max(8, r.right - w), vw - w - 8);
		const top = below ? r.bottom + 6 : r.top - 6 - h;
		el.style.left = `${left}px`;
		el.style.top = `${top}px`;
		el.style.transformOrigin = `${r.left + r.width / 2 - left}px ${below ? 0 : h}px`;
		el.querySelector<HTMLElement>("[role^=menuitem]")?.focus({ preventScroll: true });
		m.anchor.setAttribute("aria-expanded", "true");
		return () => m.anchor.setAttribute("aria-expanded", "false");
	}, [m]);

	useEffect(() => {
		if (!m) return;
		const onDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (ref.current?.contains(target) || m.anchor.contains(target)) return;
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
		<div ref={ref} class="menu" role="menu" aria-label={m.label} data-instant={m.instant ? "" : undefined} onKeyDown={onKeyDown}>
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
