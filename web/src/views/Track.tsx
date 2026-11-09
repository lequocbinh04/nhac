// /track/<id>[?t=seconds]: the album page with that song marked, the song cued (paused) in the
// player, and a clear Play button. No autoplay: browsers block it without a gesture.
import { useEffect, useRef } from "preact/hooks";
import { Cover } from "../components/Cover";
import { Empty } from "../components/bits";
import { Icon } from "../components/icons";
import { formatTime } from "../lib/format";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import { parseStart } from "../lib/links";
import * as player from "../lib/player";
import { href, nav } from "../lib/router";
import type { Track } from "../lib/types";
import { AlbumView } from "./Album";

function PlayCta({ track, start, ids, index }: { track: Track; start: number; ids: string[]; index: number }) {
	const t = dict.value;
	const c = catalog();
	const button = useRef<HTMLButtonElement>(null);
	const isCurrent = player.current.value?.id === track.id;
	const isPlaying = isCurrent && player.playing.value;
	const album = c.album.get(track.albumId);

	// Keyboard and screen-reader users land on the one thing to do.
	useEffect(() => {
		button.current?.focus({ preventScroll: true });
	}, [track.id]);

	const onClick = () => {
		if (isPlaying) player.pause();
		else if (isCurrent) player.play();
		else {
			// Something else was playing when the link opened; switch to this song now.
			player.cueTracks(ids, index, start);
			player.play();
		}
	};

	return (
		<section class="track-cta" aria-label={t.playThis}>
			<Cover albumId={track.albumId} hasCover={!!album?.album.cover} size={56} eager />
			<span class="track-cta-text">
				<span class="track-cta-title">{track.title}</span>
				<span class="track-cta-sub">
					{track.artist}
					{start > 0 && <span class="mono"> · {t.startsAt(formatTime(start))}</span>}
				</span>
			</span>
			<button ref={button} type="button" class="btn btn-primary track-cta-play" onClick={onClick}>
				<Icon name={isPlaying ? "pause" : "play"} size={18} />
				<span>{isPlaying ? t.pause : t.playThis}</span>
			</button>
		</section>
	);
}

export function TrackView({ id, t: rawStart }: { id: string; t: string | null }) {
	const t = dict.value;
	const c = catalog();
	const track = c.track.get(id);
	const info = track ? c.album.get(track.albumId) : undefined;
	const ids = info?.tracks.map((x) => x.id) ?? (track ? [track.id] : []);
	const index = Math.max(0, track ? ids.indexOf(track.id) : 0);
	const start = track ? parseStart(rawStart, track.dur) : 0;
	const ready = player.ready.value;

	// Cue the song once the player has restored its session; never interrupt music already playing.
	useEffect(() => {
		if (!track || !ready) return;
		const cur = player.current.peek();
		if (player.playing.peek() && cur?.id !== track.id) return;
		player.cueTracks(ids, index, start);
	}, [track?.id, start, ready]);

	// Bring the song's row into view (instantly: this is arrival, not a transition).
	useEffect(() => {
		if (!track || nav.peek().kind === "pop") return;
		const raf = requestAnimationFrame(() => {
			document.querySelector<HTMLElement>(`.trow[data-track="${CSS.escape(track.id)}"]`)?.scrollIntoView({ block: "nearest" });
		});
		return () => cancelAnimationFrame(raf);
	}, [track?.id]);

	if (!track || !info) {
		return (
			<Empty title={t.trackNotFound} body={t.trackNotFoundBody} icon={<Icon name="musicNote" size={28} />}>
				<a class="btn" href={href.albums()}>
					{t.goToLibrary}
				</a>
			</Empty>
		);
	}
	return <AlbumView id={info.album.id} focusTrackId={track.id} banner={<PlayCta track={track} start={start} ids={ids} index={index} />} />;
}
