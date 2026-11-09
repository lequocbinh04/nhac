// Desktop navigation rail and mobile tab bar.
import { formatBytes } from "../lib/format";
import { dict, locale } from "../lib/i18n";
import { library } from "../lib/library";
import { href, nav, type Route } from "../lib/router";
import { Icon, type IconName } from "./icons";

type Section = "albums" | "artists" | "songs" | "queue" | "search" | "settings";

export function sectionOf(r: Route): Section | null {
	switch (r.name) {
		case "albums":
		case "album":
			return "albums";
		case "artists":
		case "artist":
			return "artists";
		case "songs":
			return "songs";
		case "queue":
			return "queue";
		case "search":
			return "search";
		case "settings":
			return "settings";
		default:
			return null;
	}
}

function NavLink({ to, icon, label, active }: { to: string; icon: IconName; label: string; active: boolean }) {
	return (
		<a href={to} class="nav-link" aria-current={active ? "page" : undefined}>
			<Icon name={icon} size={20} />
			<span>{label}</span>
		</a>
	);
}

export function Sidebar() {
	const t = dict.value;
	const s = sectionOf(nav.value.route);
	const lib = library.value;
	return (
		<aside class="sidebar">
			<a href={href.albums()} class="brand" aria-label={t.appName}>
				<Icon name="waveform" size={22} class="brand-mark" />
				<span>{t.appName}</span>
			</a>
			<nav class="nav" aria-label={t.mainNav}>
				<NavLink to={href.albums()} icon="vinylRecord" label={t.navAlbums} active={s === "albums"} />
				<NavLink to={href.artists()} icon="microphone" label={t.navArtists} active={s === "artists"} />
				<NavLink to={href.songs()} icon="musicNotes" label={t.navSongs} active={s === "songs"} />
				<NavLink to={href.queue()} icon="queue" label={t.navQueue} active={s === "queue"} />
			</nav>
			<div class="sidebar-foot">
				{lib.status === "ready" && (
					<div class="sidebar-stats mono">
						<div>
							{t.countTracks(lib.catalog.tracks.length)} · {t.countAlbums(lib.catalog.albums.length)}
						</div>
						<div>
							{formatBytes(lib.catalog.data.stats.bytes, locale.value)} · {t.hiResTracks(lib.catalog.hiResTracks)}
						</div>
					</div>
				)}
				<NavLink to={href.settings()} icon="gearSix" label={t.navSettings} active={s === "settings"} />
			</div>
		</aside>
	);
}

export function TabBar() {
	const t = dict.value;
	const s = sectionOf(nav.value.route);
	const lib = s === "albums" || s === "artists" || s === "songs";
	return (
		<nav class="tabbar" aria-label={t.mainNav}>
			<a href={href.albums()} class="tab" aria-current={lib ? "page" : undefined}>
				<Icon name="vinylRecord" size={24} />
				<span>{t.navLibrary}</span>
			</a>
			<a href={href.search("")} class="tab" aria-current={s === "search" ? "page" : undefined}>
				<Icon name="magnifyingGlass" size={24} />
				<span>{t.navSearch}</span>
			</a>
			<a href={href.queue()} class="tab" aria-current={s === "queue" ? "page" : undefined}>
				<Icon name="queue" size={24} />
				<span>{t.navQueue}</span>
			</a>
			<a href={href.settings()} class="tab" aria-current={s === "settings" ? "page" : undefined}>
				<Icon name="gearSix" size={24} />
				<span>{t.navSettings}</span>
			</a>
		</nav>
	);
}

/** Mobile: Album · Nghệ sĩ · Bài hát switcher at the top of library views. */
export function LibraryTabs() {
	const t = dict.value;
	const s = sectionOf(nav.value.route);
	return (
		<nav class="libtabs" aria-label={t.libraryNav}>
			<a href={href.albums()} aria-current={s === "albums" ? "page" : undefined}>
				{t.navAlbums}
			</a>
			<a href={href.artists()} aria-current={s === "artists" ? "page" : undefined}>
				{t.navArtists}
			</a>
			<a href={href.songs()} aria-current={s === "songs" ? "page" : undefined}>
				{t.navSongs}
			</a>
		</nav>
	);
}
