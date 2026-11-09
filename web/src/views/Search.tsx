import { useMemo, useState } from "preact/hooks";
import { AlbumGrid } from "../components/AlbumGrid";
import { Cover } from "../components/Cover";
import { Empty, Highlight } from "../components/bits";
import { Icon } from "../components/icons";
import { SearchField } from "../components/Topbar";
import { TrackList } from "../components/TrackList";
import type { AlbumInfo, ArtistItem, Catalog, SearchItem } from "../lib/catalog";
import { shortSpec, trackSpec } from "../lib/format";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import * as player from "../lib/player";
import { back, href } from "../lib/router";
import { parseQuery, searchEntries, type Hit, type Span } from "../lib/search";
import type { Track } from "../lib/types";
import { searchText } from "../lib/ui";

const SONGS_PREVIEW = 6;

function run(c: Catalog, text: string) {
	const q = parseQuery(text);
	if (!q.tokens.length) return null;
	const artists = searchEntries(c.search.artists, q, 8);
	const albums = searchEntries(c.search.albums, q, 24);
	const tracks = searchEntries(c.search.tracks, q);
	const candidates: (Hit<SearchItem> | undefined)[] = [artists.hits[0], albums.hits[0], tracks.hits[0]];
	const top = candidates.filter((h): h is Hit<SearchItem> => !!h).sort((a, b) => b.score - a.score)[0] ?? null;
	return { artists, albums, tracks, top };
}

function TopResult({ hit }: { hit: Hit<SearchItem> }) {
	const t = dict.value;
	const c = catalog();
	const it = hit.item;
	if (it.kind === "artist") {
		const a = it.artist;
		const cover = a.coverAlbumId ? c.album.get(a.coverAlbumId) : undefined;
		return (
			<a class="top-hit" href={href.artist(a.key)}>
				<Cover albumId={a.coverAlbumId} hasCover={!!cover?.album.cover} size={72} class="avatar" />
				<span class="top-hit-text">
					<span class="top-hit-title">
						<Highlight text={a.name} spans={hit.spans[0]} />
					</span>
					<span class="top-hit-sub">
						{t.kindArtist} · {t.countTracks(a.trackIds.length)}
					</span>
				</span>
			</a>
		);
	}
	if (it.kind === "album") {
		const info = c.album.get(it.album.id)!;
		return (
			<a class="top-hit" href={href.album(it.album.id)}>
				<Cover albumId={it.album.id} hasCover={it.album.cover} size={72} />
				<span class="top-hit-text">
					<span class="top-hit-title">
						<Highlight text={it.album.title} spans={hit.spans[0]} />
					</span>
					<span class="top-hit-sub">
						{t.kindAlbum} · <Highlight text={it.album.artist} spans={hit.spans[1]} />
					</span>
				</span>
				<span class="top-hit-spec mono">{shortSpec(info)}</span>
			</a>
		);
	}
	const tr = it.track;
	const info = c.album.get(tr.albumId);
	return (
		<button type="button" class="top-hit" onClick={() => player.playTracks([tr.id], 0)}>
			<Cover albumId={tr.albumId} hasCover={!!info?.album.cover} size={72} />
			<span class="top-hit-text">
				<span class="top-hit-title">
					<Highlight text={tr.title} spans={hit.spans[0]} />
				</span>
				<span class="top-hit-sub">
					{t.kindSong} · <Highlight text={tr.artist} spans={hit.spans[1]} />
				</span>
			</span>
			<span class="top-hit-spec mono">{trackSpec(tr)}</span>
		</button>
	);
}

function ArtistHits({ hits }: { hits: Hit<ArtistItem>[] }) {
	const c = catalog();
	return (
		<ul class="artist-hits">
			{hits.map((h) => {
				const a = h.item.artist;
				const cover = a.coverAlbumId ? c.album.get(a.coverAlbumId) : undefined;
				return (
					<li key={a.key}>
						<a class="artist-hit" href={href.artist(a.key)}>
							<Cover albumId={a.coverAlbumId} hasCover={!!cover?.album.cover} size={96} class="avatar" />
							<span class="artist-hit-name">
								<Highlight text={a.name} spans={h.spans[0]} />
							</span>
						</a>
					</li>
				);
			})}
		</ul>
	);
}

export function SearchView({ q }: { q: string }) {
	const t = dict.value;
	const c = catalog();
	const text = searchText.value || q;
	const r = useMemo(() => run(c, text), [c, text]);
	const [allSongs, setAllSongs] = useState(false);

	const trackSpans = useMemo(() => new Map<string, Span[][]>(r?.tracks.hits.map((h) => [h.item.track.id, h.spans]) ?? []), [r]);
	const albumSpans = useMemo(() => new Map<string, Span[][]>(r?.albums.hits.map((h) => [h.item.album.id, h.spans]) ?? []), [r]);
	const albumInfos = useMemo(() => r?.albums.hits.map((h) => c.album.get(h.item.album.id)).filter((x): x is AlbumInfo => !!x) ?? [], [r, c]);
	const tracks = useMemo<Track[]>(() => r?.tracks.hits.map((h) => h.item.track) ?? [], [r]);
	const shown = allSongs ? tracks : tracks.slice(0, SONGS_PREVIEW);
	const ids = shown.map((x) => x.id);
	const empty = r && !r.top;

	return (
		<div class="page search-page">
			<div class="page-head search-head">
				<h1 class="page-title" tabIndex={-1}>
					{t.navSearch}
				</h1>
			</div>
			<div class="search-mobile">
				<SearchField large autoFocusMobile />
				<button type="button" class="link-btn" onClick={() => back(href.albums())}>
					{t.searchCancel}
				</button>
			</div>
			{!r ? (
				<Empty title={t.searchEmptyTitle} body={t.searchEmptyBody} icon={<Icon name="magnifyingGlass" size={28} />} />
			) : empty ? (
				<Empty title={t.searchNoResults(text.trim())} body={t.searchNoResultsBody} />
			) : (
				<>
					<p class="search-meta">
						{t.searchHint} · {t.searchMatches(r.tracks.total)}
					</p>
					{r.top && (
						<section class="section">
							<h2 class="section-title">{t.topResult}</h2>
							<TopResult hit={r.top} />
						</section>
					)}
					{tracks.length > 0 && (
						<section class="section">
							<div class="section-head">
								<h2 class="section-title">{t.songsHeading}</h2>
								{tracks.length > SONGS_PREVIEW && (
									<button type="button" class="section-link" aria-expanded={allSongs} onClick={() => setAllSongs(!allSongs)}>
										{allSongs ? t.showLess : `${t.seeAll} (${tracks.length})`}
									</button>
								)}
							</div>
							<TrackList tracks={shown} variant="list" spans={trackSpans} label={t.songsHeading} onPlay={(i) => player.playTracks(ids, i)} />
						</section>
					)}
					{r.artists.hits.length > 0 && (
						<section class="section">
							<h2 class="section-title">{t.navArtists}</h2>
							<ArtistHits hits={r.artists.hits} />
						</section>
					)}
					{albumInfos.length > 0 && (
						<section class="section">
							<h2 class="section-title">{t.albumsHeading}</h2>
							<AlbumGrid albums={albumInfos} spans={albumSpans} label={t.albumsHeading} />
						</section>
					)}
				</>
			)}
		</div>
	);
}
