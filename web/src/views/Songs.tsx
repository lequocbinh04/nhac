import { useMemo } from "preact/hooks";
import { Empty } from "../components/bits";
import { Icon } from "../components/icons";
import { LibraryTabs } from "../components/Sidebar";
import { TrackList } from "../components/TrackList";
import { compareText } from "../lib/catalog";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import * as player from "../lib/player";
import { isSuspect, verdictOf } from "../lib/quality";
import { songFilter, type SongFilter } from "../lib/ui";

export function SongsView() {
	const t = dict.value;
	const c = catalog();
	// Quality chips only exist once the library has been analysed.
	const analysed = c.quality.none < c.tracks.length;
	const filter = analysed ? songFilter.value : "all";
	const sorted = useMemo(() => [...c.tracks].sort((a, b) => compareText(a.title, b.title) || compareText(a.artist, b.artist)), [c]);
	const tracks = useMemo(
		() => (filter === "all" ? sorted : sorted.filter((x) => (filter === "suspect" ? isSuspect(x) : verdictOf(x.quality) === "lossless"))),
		[sorted, filter],
	);
	const ids = useMemo(() => tracks.map((x) => x.id), [tracks]);
	const filters: [SongFilter, string][] = [
		["all", t.filterAll],
		["lossless", t.filterLossless],
		["suspect", t.filterSuspect],
	];
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
					disabled={!ids.length}
					onClick={() => player.playTracks(ids, Math.floor(Math.random() * ids.length), { shuffle: true })}
				>
					<Icon name="shuffle" size={18} />
					<span>{t.shuffle}</span>
				</button>
			</div>
			<div class="toolbar">
				{analysed && (
					<div class="chips" role="group" aria-label={t.filterLabel}>
						{filters.map(([k, label]) => (
							<button key={k} type="button" class="chip" aria-pressed={filter === k} onClick={() => (songFilter.value = k)}>
								{label}
							</button>
						))}
					</div>
				)}
				<span class="toolbar-count mono">{t.countTracks(tracks.length)}</span>
			</div>
			{tracks.length ? (
				<>
					<div class="tracks-head" aria-hidden="true">
						<span />
						<span>{t.colTitle}</span>
						<span>{t.colAlbum}</span>
						<span>{t.colSpec}</span>
						<span>{t.colTime}</span>
						<span />
					</div>
					<TrackList tracks={tracks} variant="list" label={t.navSongs} onPlay={(i) => player.playTracks(ids, i)} />
				</>
			) : (
				<Empty title={t.noSongsFilter} />
			)}
		</div>
	);
}
