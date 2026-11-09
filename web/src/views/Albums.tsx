import { useMemo } from "preact/hooks";
import { AlbumGrid } from "../components/AlbumGrid";
import { Empty } from "../components/bits";
import { Icon } from "../components/icons";
import { openMenu } from "../components/Menu";
import { LibraryTabs } from "../components/Sidebar";
import { compareText, type AlbumInfo, type Catalog } from "../lib/catalog";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import { albumFilter, albumSort, type AlbumFilter, type AlbumSort } from "../lib/ui";

function sortAlbums(c: Catalog, sort: AlbumSort, filter: AlbumFilter): AlbumInfo[] {
	const list: AlbumInfo[] = [];
	for (const a of c.albums) {
		const info = c.album.get(a.id);
		if (!info) continue;
		if (filter === "hires" && !info.hiRes) continue;
		if (filter === "cd" && !info.cd) continue;
		if (filter === "suspect" && !info.suspect) continue;
		list.push(info);
	}
	const byTitle = (x: AlbumInfo, y: AlbumInfo) => compareText(x.album.title, y.album.title);
	const byArtist = (x: AlbumInfo, y: AlbumInfo) => compareText(x.album.artist, y.album.artist);
	// Newest first; albums without a year go last.
	const byYear = (x: AlbumInfo, y: AlbumInfo) => (Number(y.album.year) || 0) - (Number(x.album.year) || 0);
	if (sort === "title") list.sort((x, y) => byTitle(x, y) || byArtist(x, y));
	else if (sort === "year") list.sort((x, y) => byYear(x, y) || byArtist(x, y) || byTitle(x, y));
	else list.sort((x, y) => byArtist(x, y) || byYear(x, y) || byTitle(x, y));
	return list;
}

export function AlbumsView() {
	const t = dict.value;
	const c = catalog();
	const sort = albumSort.value;
	// The suspect chip only exists once the library has been analysed.
	const analysed = c.quality.none < c.tracks.length;
	const filter = albumFilter.value === "suspect" && !analysed ? "all" : albumFilter.value;
	const albums = useMemo(() => sortAlbums(c, sort, filter), [c, sort, filter]);
	const sortLabel = sort === "title" ? t.sortTitle : sort === "year" ? t.sortYear : t.sortArtist;
	const filters: [AlbumFilter, string][] = [
		["all", t.filterAll],
		["hires", t.filterHiRes],
		["cd", t.filterCd],
	];
	if (analysed) filters.push(["suspect", t.filterSuspect]);

	return (
		<div class="page">
			<LibraryTabs />
			<div class="page-head">
				<h1 class="page-title" tabIndex={-1}>
					{t.navAlbums}
				</h1>
				<button
					type="button"
					class="pill"
					aria-haspopup="menu"
					aria-expanded="false"
					aria-label={`${t.sortLabel}: ${sortLabel}`}
					onClick={(e) =>
						openMenu(
							e,
							t.sortLabel,
							(
								[
									["artist", t.sortArtist],
									["title", t.sortTitle],
									["year", t.sortYear],
								] as [AlbumSort, string][]
							).map(([k, label]) => ({ label, checked: k === sort, onSelect: () => (albumSort.value = k) })),
							true,
						)
					}
				>
					<Icon name="sortDescending" size={18} />
					<span>{sortLabel}</span>
				</button>
			</div>
			<div class="toolbar">
				<div class="chips" role="group" aria-label={t.filterLabel}>
					{filters.map(([k, label]) => (
						<button key={k} type="button" class="chip" aria-pressed={filter === k} onClick={() => (albumFilter.value = k)}>
							{label}
						</button>
					))}
				</div>
				<span class="toolbar-count mono">
					{t.countAlbums(albums.length)} · {t.countArtists(c.artists.length)}
				</span>
			</div>
			{albums.length ? <AlbumGrid albums={albums} label={t.navAlbums} /> : <Empty title={t.noResultsFilter} />}
		</div>
	);
}
