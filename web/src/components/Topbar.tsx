// Sticky bar over the main column: back link on detail pages, search field on desktop.
import { useEffect, useRef } from "preact/hooks";
import { dict } from "../lib/i18n";
import { back, href, nav, navigate } from "../lib/router";
import { isMobile, registerSearchField, searchText } from "../lib/ui";
import { Icon } from "./icons";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Shared by the desktop bar and the mobile search view. */
export function SearchField({ autoFocusMobile = false, large = false }: { autoFocusMobile?: boolean; large?: boolean }) {
	const t = dict.value;
	const input = useRef<HTMLInputElement>(null);
	const mobile = isMobile.value;
	const owner = large === mobile;

	useEffect(() => {
		if (!owner) return;
		registerSearchField(() => input.current?.focus());
		return () => registerSearchField(null);
	}, [owner]);

	useEffect(() => {
		if (autoFocusMobile && owner && nav.value.kind !== "pop" && !searchText.value) input.current?.focus({ preventScroll: true });
	}, []);

	const onInput = (e: Event) => {
		const v = (e.currentTarget as HTMLInputElement).value;
		searchText.value = v;
		const onSearch = nav.value.route.name === "search";
		navigate(href.search(v.trim()), { replace: onSearch, keyboard: true });
	};
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key !== "Escape") return;
		e.preventDefault();
		if (searchText.value) {
			searchText.value = "";
			if (nav.value.route.name === "search") navigate(href.search(""), { replace: true, keyboard: true });
		} else input.current?.blur();
	};
	const clear = () => {
		searchText.value = "";
		if (nav.value.route.name === "search") navigate(href.search(""), { replace: true, keyboard: true });
		input.current?.focus();
	};

	return (
		<form class={`search ${large ? "search-lg" : ""}`} role="search" onSubmit={(e) => e.preventDefault()}>
			<Icon name="magnifyingGlass" size={large ? 20 : 18} class="search-icon" />
			<input
				ref={input}
				type="search"
				enterKeyHint="search"
				autoComplete="off"
				autoCorrect="off"
				spellcheck={false}
				aria-label={t.searchLabel}
				placeholder={t.searchPlaceholder}
				value={searchText.value}
				onInput={onInput}
				onKeyDown={onKeyDown}
			/>
			{searchText.value ? (
				<button type="button" class="search-clear" aria-label={t.searchClear} onClick={clear}>
					<Icon name="xCircle" size={20} />
				</button>
			) : (
				!large && (
					<kbd class="search-kbd mono" aria-hidden="true">
						{isMac ? "⌘K" : "Ctrl K"}
					</kbd>
				)
			)}
		</form>
	);
}

export function Topbar() {
	const t = dict.value;
	const r = nav.value.route;
	const backTo = r.name === "album" ? { label: t.navAlbums, href: href.albums() } : r.name === "artist" ? { label: t.navArtists, href: href.artists() } : null;
	const mobile = isMobile.value;
	if (mobile && !backTo) return null;
	return (
		<header class="topbar">
			{backTo ? (
				<a
					class="back"
					href={backTo.href}
					onClick={(e) => {
						e.preventDefault();
						back(backTo.href);
					}}
				>
					<Icon name="caretLeft" size={16} />
					<span>{backTo.label}</span>
				</a>
			) : (
				<span />
			)}
			{!mobile && <SearchField />}
		</header>
	);
}
