import { useMemo } from "preact/hooks";
import { Icon } from "../components/icons";
import { LibraryTabs } from "../components/Sidebar";
import { TrackList } from "../components/TrackList";
import { compareText } from "../lib/catalog";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import * as player from "../lib/player";

export function SongsView() {
	const t = dict.value;
	const c = catalog();
	const tracks = useMemo(() => [...c.tracks].sort((a, b) => compareText(a.title, b.title) || compareText(a.artist, b.artist)), [c]);
	const ids = useMemo(() => tracks.map((x) => x.id), [tracks]);
	return (
		<div class="page">
			<LibraryTabs />
			<div class="page-head">
				<h1 class="page-title" tabIndex={-1}>
					{t.navSongs}
				</h1>
				<button
					type="button"
					class="pill"
					aria-label={t.shuffle}
					onClick={() => player.playTracks(ids, Math.floor(Math.random() * ids.length), { shuffle: true })}
				>
					<Icon name="shuffle" size={18} />
					<span>{t.shuffle}</span>
				</button>
			</div>
			<div class="toolbar">
				<span class="toolbar-count mono">{t.countTracks(tracks.length)}</span>
			</div>
			<div class="tracks-head" aria-hidden="true">
				<span />
				<span>{t.colTitle}</span>
				<span>{t.colAlbum}</span>
				<span>{t.colSpec}</span>
				<span>{t.colTime}</span>
				<span />
			</div>
			<TrackList tracks={tracks} variant="list" label={t.navSongs} onPlay={(i) => player.playTracks(ids, i)} />
		</div>
	);
}
