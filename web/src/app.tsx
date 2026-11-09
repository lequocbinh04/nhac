// App shell: sidebar + main + player bar (desktop), tab bar + mini player (mobile), the Now
// Playing sheet, menus and toasts. Owns scroll reset/restore and the view transition.
import { useLayoutEffect, useRef } from "preact/hooks";
import { Empty } from "./components/bits";
import { Icon } from "./components/icons";
import { MenuHost } from "./components/Menu";
import { NowPlaying } from "./components/NowPlaying";
import { MiniPlayer, PlayerBar } from "./components/PlayerBar";
import { Sidebar, TabBar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { Topbar } from "./components/Topbar";
import { dict } from "./lib/i18n";
import { library, loadLibrary } from "./lib/library";
import { nav, savedScroll, setScrollElement, type Route } from "./lib/router";
import { isMobile, nowPlayingOpen, reducedMotion } from "./lib/ui";
import { AlbumView } from "./views/Album";
import { AlbumsView } from "./views/Albums";
import { ArtistView, ArtistsView } from "./views/Artists";
import { QueueView } from "./views/Queue";
import { SearchView } from "./views/Search";
import { SettingsView } from "./views/Settings";
import { SongsView } from "./views/Songs";

function View({ route }: { route: Route }) {
	const t = dict.value;
	switch (route.name) {
		case "albums":
			return <AlbumsView />;
		case "album":
			return <AlbumView id={route.id} />;
		case "artists":
			return <ArtistsView />;
		case "artist":
			return <ArtistView artistKey={route.key} />;
		case "songs":
			return <SongsView />;
		case "queue":
			return <QueueView />;
		case "search":
			return <SearchView q={route.q} />;
		case "settings":
			return <SettingsView />;
		default:
			return <Empty title={t.notFound} body={t.notFoundBody} />;
	}
}

function Skeleton() {
	const t = dict.value;
	return (
		<div class="page" aria-busy="true" aria-label={t.loadingLibrary}>
			<div class="page-head">
				<span class="sk sk-title" />
			</div>
			<div class="toolbar">
				<span class="sk sk-chip" />
				<span class="sk sk-chip" />
				<span class="sk sk-chip" />
			</div>
			<div class="grid">
				{Array.from({ length: 15 }, (_, i) => (
					<div key={i} class="sk-card">
						<span class="sk sk-cover" />
						<span class="sk sk-line" />
						<span class="sk sk-line sk-short" />
					</div>
				))}
			</div>
		</div>
	);
}

export function App() {
	const t = dict.value;
	const lib = library.value;
	const n = nav.value;
	const mobile = isMobile.value;
	const npOpen = nowPlayingOpen.value;
	const main = useRef<HTMLElement>(null);
	const view = useRef<HTMLDivElement>(null);
	const ready = lib.status === "ready";

	if (!main.current) setScrollElement(() => main.current);

	useLayoutEffect(() => {
		const el = main.current;
		if (!el || !ready) return;
		if (n.kind === "push") el.scrollTop = 0;
		else if (n.kind === "pop" || n.kind === "initial") el.scrollTop = savedScroll(n.key) ?? 0;
		if (n.kind !== "push") return;
		// Move focus to the new page heading, except while typing a search.
		if (n.route.name !== "search") view.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
		// Pointer navigations get a short fade/rise; keyboard and back/forward stay instant.
		if (!n.keyboard && !reducedMotion()) {
			view.current?.animate(
				[
					{ opacity: 0, transform: "translateY(6px)" },
					{ opacity: 1, transform: "none" },
				],
				{ duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
			);
		}
	}, [n, ready]);

	let content;
	if (lib.status === "loading") content = <Skeleton />;
	else if (lib.status === "error")
		content = (
			<Empty title={t.libraryError} body={t.libraryErrorBody} icon={<Icon name="warningCircle" size={28} />}>
				<button type="button" class="btn btn-primary" onClick={() => void loadLibrary()}>
					<Icon name="arrowCounterClockwise" size={18} />
					<span>{t.retry}</span>
				</button>
			</Empty>
		);
	else if (!lib.catalog.tracks.length) content = <Empty title={t.emptyLibrary} body={t.emptyLibraryBody} icon={<Icon name="musicNotes" size={28} />} />;
	else content = <View route={n.route} />;

	return (
		<div class="app" data-mobile={mobile ? "" : undefined}>
			<a class="skip" href="#main">
				{t.skipToContent}
			</a>
			<div class="shell" inert={npOpen}>
				{!mobile && <Sidebar />}
				<main id="main" ref={main} class="main" tabIndex={-1}>
					{ready && <Topbar />}
					<div ref={view} class="view" key={n.key}>
						{content}
					</div>
				</main>
				{ready && !mobile && <PlayerBar />}
				{ready && mobile && (
					<div class="dock">
						<MiniPlayer />
						<TabBar />
					</div>
				)}
			</div>
			{ready && <NowPlaying />}
			<MenuHost />
			<Toasts />
		</div>
	);
}
