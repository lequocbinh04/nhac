// Desktop bottom player bar and the mobile mini player.
import { useEffect, useRef } from "preact/hooks";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import { isAppleMobile } from "../lib/meter";
import * as player from "../lib/player";
import { href, nav } from "../lib/router";
import { onFrame } from "../lib/ticker";
import { nowPlayingOpen } from "../lib/ui";
import { trackSpec } from "../lib/format";
import { Cover } from "./Cover";
import { Quality } from "./bits";
import { Icon } from "./icons";
import { Seekbar } from "./Seekbar";
import { PlayButton, Time, Transport } from "./Transport";

/** Volume is read-only on iOS, so the control is hidden there. */
const volumeSettable = !isAppleMobile();

function Volume() {
	const t = dict.value;
	const v = player.volume.value;
	const m = player.muted.value;
	const level = m ? 0 : v;
	return (
		<div class="volume">
			<button type="button" class="icon-btn" aria-label={m ? t.unmute : t.mute} aria-pressed={m} onClick={() => player.toggleMute()}>
				<Icon name={level === 0 ? "speakerX" : level < 0.5 ? "speakerLow" : "speakerHigh"} size={20} />
			</button>
			<input
				type="range"
				class="range"
				min={0}
				max={1}
				step={0.01}
				value={level}
				aria-label={t.volume}
				aria-valuetext={`${Math.round(level * 100)}%`}
				style={{ "--fill": `${level * 100}%` }}
				onInput={(e) => player.setVolume(Number((e.currentTarget as HTMLInputElement).value))}
			/>
		</div>
	);
}

export function openNowPlaying(e: Event) {
	(e.currentTarget as HTMLElement).dataset.opener = "";
	nowPlayingOpen.value = true;
}

export function PlayerBar() {
	const t = dict.value;
	const tr = player.current.value;
	const c = catalog();
	const info = tr ? c.album.get(tr.albumId) : undefined;
	const onQueue = nav.value.route.name === "queue";
	return (
		<footer class="playerbar" aria-label={t.nowPlaying}>
			<div class="pb-left">
				{tr ? (
					<>
						<button type="button" class="pb-cover" aria-label={t.openNowPlaying} onClick={openNowPlaying}>
							<Cover albumId={tr.albumId} hasCover={!!info?.album.cover} size={56} eager />
						</button>
						<div class="pb-meta">
							<a class="pb-title" href={info ? href.album(info.album.id) : undefined}>
								{tr.title}
							</a>
							<span class="pb-artist">
								{info?.artists[0] ? (
									<a href={href.artist(info.artists[0].key)} class="link-quiet">
										{tr.artist}
									</a>
								) : (
									tr.artist
								)}
							</span>
						</div>
					</>
				) : (
					<div class="pb-meta pb-idle">
						<span class="pb-title">{t.nothingPlaying}</span>
						<span class="pb-artist">{t.pickSomething}</span>
					</div>
				)}
			</div>
			<div class="pb-center">
				<Transport size="md" />
				<div class="pb-seek">
					<Time mode="elapsed" class="pb-time" />
					<Seekbar variant="bar" />
					<Time mode="total" class="pb-time pb-time-total" />
				</div>
			</div>
			<div class="pb-right">
				{tr && <Quality track={tr} />}
				<a
					href={href.queue()}
					class="icon-btn toggle"
					aria-label={t.navQueue}
					aria-pressed={onQueue}
					onClick={(e) => {
						if (onQueue) {
							e.preventDefault();
							history.back();
						}
					}}
				>
					<Icon name="queue" size={20} />
				</a>
				{volumeSettable && <Volume />}
				<button type="button" class="icon-btn" aria-label={t.openNowPlaying} disabled={!tr} onClick={openNowPlaying}>
					<Icon name="caretUp" size={20} />
				</button>
			</div>
		</footer>
	);
}

/** Thin progress line under the mini player. */
function MiniProgress() {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		let last = -1;
		return onFrame(() => {
			const d = player.duration.value;
			const p = d > 0 ? Math.min(1, player.position() / d) : 0;
			if (Math.abs(p - last) > 0.001 && ref.current) {
				last = p;
				ref.current.style.transform = `scaleX(${p})`;
			}
		});
	}, []);
	return (
		<div class="mini-progress" aria-hidden="true">
			<div ref={ref} />
		</div>
	);
}

export function MiniPlayer() {
	const t = dict.value;
	const tr = player.current.value;
	if (!tr) return null;
	const info = catalog().album.get(tr.albumId);
	return (
		<div class="mini">
			<button type="button" class="mini-open" aria-label={`${t.openNowPlaying}: ${tr.title}`} onClick={openNowPlaying}>
				<Cover albumId={tr.albumId} hasCover={!!info?.album.cover} size={44} eager />
				<span class="mini-meta">
					<span class="mini-title">{tr.title}</span>
					<span class="mini-sub">
						<span class="mini-artist">{tr.artist}</span>
						<span class="mini-spec mono"> · {trackSpec(tr)}</span>
					</span>
				</span>
			</button>
			<PlayButton size="sm" />
			<button type="button" class="icon-btn strong" aria-label={t.next} onClick={() => player.next()}>
				<Icon name="skipForward" size={24} />
			</button>
			<MiniProgress />
		</div>
	);
}
