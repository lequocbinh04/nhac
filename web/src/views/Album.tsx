import type { ComponentChildren } from "preact";
import { Cover } from "../components/Cover";
import { ArtistLinks, Empty } from "../components/bits";
import { Icon } from "../components/icons";
import { contextMenu, openMenu } from "../components/Menu";
import { albumMenuItems } from "../components/menus";
import { TrackList } from "../components/TrackList";
import type { AlbumInfo } from "../lib/catalog";
import { formatTime } from "../lib/format";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import * as player from "../lib/player";
import { href } from "../lib/router";

function MoreFrom({ info }: { info: AlbumInfo }) {
	const t = dict.value;
	const c = catalog();
	const artist = info.artists[0];
	if (!artist) return null;
	const others = artist.albumIds.filter((id) => id !== info.album.id).map((id) => c.album.get(id)).filter((x): x is AlbumInfo => !!x);
	if (!others.length) return null;
	return (
		<section class="more-from">
			<div class="section-head">
				<h2 class="section-title">{t.moreFrom(artist.name)}</h2>
				<a class="section-link" href={href.artist(artist.key)}>
					{t.viewArtist}
					<Icon name="caretRight" size={14} />
				</a>
			</div>
			<ul class="mini-albums">
				{others.slice(0, 6).map((o) => (
					<li key={o.album.id}>
						<a class="mini-album" href={href.album(o.album.id)}>
							<Cover albumId={o.album.id} hasCover={o.album.cover} size={72} />
							<span class="mini-album-text">
								<span class="mini-album-title">{o.album.title}</span>
								<span class="mini-album-meta">
									{[o.album.year, t.countTracks(o.tracks.length), formatTime(o.seconds)].filter(Boolean).join(" · ")}
								</span>
								<span class="mini-album-spec mono">
									{o.codec} {o.spec}
								</span>
							</span>
						</a>
					</li>
				))}
			</ul>
		</section>
	);
}

/** `banner` renders above the album (the shared-song call to action); `focusTrackId` marks a row. */
export function AlbumView({ id, focusTrackId, banner }: { id: string; focusTrackId?: string; banner?: ComponentChildren }) {
	const t = dict.value;
	const c = catalog();
	const info = c.album.get(id);
	if (!info) return <Empty title={t.notFound} body={t.notFoundBody} />;
	const a = info.album;
	const ids = info.tracks.map((x) => x.id);
	const isCurrent = player.current.value?.albumId === a.id;
	const isPlaying = isCurrent && player.playing.value;
	const meta = [a.year, a.genre].filter(Boolean);

	return (
		<div class="page album-page">
			{banner}
			<section class="album-side" {...contextMenu(() => ({ label: a.title, items: albumMenuItems(info) }))}>
				<Cover albumId={a.id} hasCover={a.cover} size={384} class="album-cover" eager alt={a.title} />
				<h1 class="album-title" tabIndex={-1}>
					{a.title}
				</h1>
				<div class="album-meta">
					<ArtistLinks text={a.artist} />
					{meta.map((m) => (
						<span key={m}> · {m}</span>
					))}
				</div>
				<div class="album-spec mono">
					{t.countTracks(info.tracks.length)} · {info.codec}
					{info.spec && <span class="album-spec-hi"> {info.spec}</span>} · {formatTime(info.seconds)}
				</div>
				<div class="album-actions">
					<button
						type="button"
						class="btn btn-primary"
						onClick={() => (isCurrent ? player.toggle() : player.playTracks(ids, 0, { shuffle: false }))}
					>
						<Icon name={isPlaying ? "pause" : "play"} size={18} />
						<span>{isPlaying ? t.pause : t.play}</span>
					</button>
					<button type="button" class="btn" onClick={() => player.playTracks(ids, Math.floor(Math.random() * ids.length), { shuffle: true })}>
						<Icon name="shuffle" size={18} />
						<span>{t.shuffle}</span>
					</button>
					<button
						type="button"
						class="btn btn-round"
						data-menu-focus
						aria-label={`${t.more}: ${a.title}`}
						aria-haspopup="menu"
						aria-expanded="false"
						onClick={(e) => openMenu(e, a.title, albumMenuItems(info))}
					>
						<Icon name="dotsThree" size={20} />
					</button>
				</div>
			</section>
			<section class="album-main">
				<TrackList
					tracks={info.tracks}
					variant="album"
					albumArtist={a.artist}
					label={t.songsHeading}
					focusId={focusTrackId}
					onPlay={(i) => player.playTracks(ids, i)}
				/>
				<MoreFrom info={info} />
			</section>
		</div>
	);
}
