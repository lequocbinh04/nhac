import { useMemo, useRef } from "preact/hooks";
import { AlbumGrid } from "../components/AlbumGrid";
import { Cover } from "../components/Cover";
import { Empty } from "../components/bits";
import { Icon } from "../components/icons";
import { LibraryTabs } from "../components/Sidebar";
import { TrackList } from "../components/TrackList";
import { compareText, type AlbumInfo, type Artist } from "../lib/catalog";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import * as player from "../lib/player";
import { href } from "../lib/router";
import type { Track } from "../lib/types";
import { useVirtual } from "../lib/virtual";

const ROW_H = 68;

function ArtistRow({ a, top, index, count }: { a: Artist; top: number; index: number; count: number }) {
	const t = dict.value;
	const c = catalog();
	const cover = a.coverAlbumId ? c.album.get(a.coverAlbumId) : undefined;
	const meta = [a.albumIds.length ? t.countAlbums(a.albumIds.length) : "", t.countTracks(a.trackIds.length)].filter(Boolean).join(" · ");
	return (
		<li class="arow" style={{ transform: `translateY(${top}px)` }} aria-posinset={index + 1} aria-setsize={count}>
			<a class="arow-link" href={href.artist(a.key)}>
				<Cover albumId={a.coverAlbumId} hasCover={!!cover?.album.cover} size={48} class="avatar" />
				<span class="arow-text">
					<span class="arow-name">{a.name}</span>
					<span class="arow-meta">{meta}</span>
				</span>
				<Icon name="caretRight" size={16} class="arow-caret" />
			</a>
		</li>
	);
}

export function ArtistsView() {
	const t = dict.value;
	const c = catalog();
	const ref = useRef<HTMLUListElement>(null);
	const v = useVirtual(ref, c.artists.length, ROW_H, 8);
	return (
		<div class="page">
			<LibraryTabs />
			<div class="page-head">
				<h1 class="page-title" tabIndex={-1}>
					{t.navArtists}
				</h1>
				<span class="toolbar-count mono">{t.countArtists(c.artists.length)}</span>
			</div>
			<ul ref={ref} class="artists" aria-label={t.navArtists} style={{ height: `${v.total}px` }}>
				{v.items.map((it) => (
					<ArtistRow key={c.artists[it.index].key} a={c.artists[it.index]} top={it.start - v.margin} index={it.index} count={c.artists.length} />
				))}
			</ul>
		</div>
	);
}

export function ArtistView({ artistKey }: { artistKey: string }) {
	const t = dict.value;
	const c = catalog();
	const a = c.artist.get(artistKey);
	const albums = useMemo(
		() =>
			(a?.albumIds ?? [])
				.map((id) => c.album.get(id))
				.filter((x): x is AlbumInfo => !!x)
				.sort((x, y) => (Number(y.album.year) || 0) - (Number(x.album.year) || 0) || compareText(x.album.title, y.album.title)),
		[a, c],
	);
	const tracks = useMemo(() => (a?.trackIds ?? []).map((id) => c.track.get(id)).filter((x): x is Track => !!x), [a, c]);
	// Albums by others this artist appears on (features).
	const appearsOn = useMemo(() => {
		if (!a) return [];
		const own = new Set(a.albumIds);
		const ids = [...new Set(tracks.map((tr) => tr.albumId))].filter((id) => !own.has(id));
		return ids.map((id) => c.album.get(id)).filter((x): x is AlbumInfo => !!x);
	}, [a, c, tracks]);

	if (!a) return <Empty title={t.notFound} body={t.notFoundBody} />;
	const ids = tracks.map((x) => x.id);
	const cover = a.coverAlbumId ? c.album.get(a.coverAlbumId) : undefined;
	const isCurrent = !!player.current.value && ids.includes(player.current.value.id);

	return (
		<div class="page artist-page">
			<header class="artist-head">
				<Cover albumId={a.coverAlbumId} hasCover={!!cover?.album.cover} size={160} class="avatar artist-avatar" eager />
				<div class="artist-head-text">
					<h1 class="artist-name" tabIndex={-1}>
						{a.name}
					</h1>
					<div class="album-spec mono">
						{[a.albumIds.length ? t.countAlbums(a.albumIds.length) : "", t.countTracks(tracks.length)].filter(Boolean).join(" · ")}
					</div>
					<div class="album-actions">
						<button type="button" class="btn btn-primary" onClick={() => (isCurrent ? player.toggle() : player.playTracks(ids, 0, { shuffle: false }))}>
							<Icon name={isCurrent && player.playing.value ? "pause" : "play"} size={18} />
							<span>{isCurrent && player.playing.value ? t.pause : t.play}</span>
						</button>
						<button type="button" class="btn" onClick={() => player.playTracks(ids, Math.floor(Math.random() * ids.length), { shuffle: true })}>
							<Icon name="shuffle" size={18} />
							<span>{t.shuffle}</span>
						</button>
					</div>
				</div>
			</header>
			{albums.length > 0 && (
				<section class="section">
					<h2 class="section-title">{t.albumsHeading}</h2>
					<AlbumGrid albums={albums} label={t.albumsHeading} />
				</section>
			)}
			<section class="section">
				<h2 class="section-title">{t.songsHeading}</h2>
				<TrackList tracks={tracks} variant="list" label={t.songsHeading} onPlay={(i) => player.playTracks(ids, i)} />
			</section>
			{appearsOn.length > 0 && (
				<section class="section">
					<h2 class="section-title">{t.appearsOn}</h2>
					<AlbumGrid albums={appearsOn} label={t.appearsOn} />
				</section>
			)}
		</div>
	);
}
