// Track rows for albums, artists, songs and search. Lists over 50 rows are virtualized.
import { useRef } from "preact/hooks";
import type { Catalog } from "../lib/catalog";
import { formatTime, trackSpec } from "../lib/format";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import * as player from "../lib/player";
import { href, navigate } from "../lib/router";
import type { Span } from "../lib/search";
import { shareLink, usesNativeShare } from "../lib/share";
import { toast } from "../lib/toast";
import type { Track } from "../lib/types";
import { useVirtual } from "../lib/virtual";
import { Cover } from "./Cover";
import { ArtistLinks, Highlight, PlayingBars } from "./bits";
import { Icon } from "./icons";
import { openMenu, type MenuItem } from "./Menu";

export const VIRTUALIZE_OVER = 50;

export function trackMenuItems(c: Catalog, t: Track): MenuItem[] {
	const d = dict.value;
	const info = c.album.get(t.albumId);
	const items: MenuItem[] = [
		{
			label: d.playNext,
			onSelect: () => {
				player.playNext([t.id]);
				toast(d.addedNext(t.title));
			},
		},
		{
			label: d.addToQueue,
			onSelect: () => {
				player.addToQueue([t.id]);
				toast(d.addedQueue(t.title));
			},
		},
	];
	if (info) items.push({ label: d.goToAlbum, onSelect: () => navigate(href.album(info.album.id)) });
	const first = info?.artists[0];
	if (first) items.push({ label: d.goToArtist, onSelect: () => navigate(href.artist(first.key)) });
	items.push({ label: usesNativeShare() ? d.share : d.copyLink, onSelect: () => void shareLink(href.track(t.id), `${t.title} · ${t.artist}`) });
	return items;
}

interface Props {
	tracks: Track[];
	/** Plays the list starting at index */
	onPlay: (index: number) => void;
	variant: "album" | "list";
	/** Album artist: track artists equal to it are not repeated (album variant) */
	albumArtist?: string;
	/** Highlight spans per track id: [title, artist, album] */
	spans?: Map<string, Span[][]>;
	label: string;
	/** Track to mark (opened from a shared link) */
	focusId?: string;
}

const ROW_H = { album: 52, list: 60 };

export function TrackList(props: Props) {
	return props.tracks.length > VIRTUALIZE_OVER ? <VirtualTracks {...props} /> : <PlainTracks {...props} />;
}

function PlainTracks(props: Props) {
	return (
		<ul class={`tracks tracks-${props.variant}`} aria-label={props.label}>
			{props.tracks.map((t, i) => (
				<Row key={t.id} {...props} track={t} index={i} />
			))}
		</ul>
	);
}

function VirtualTracks(props: Props) {
	const ref = useRef<HTMLUListElement>(null);
	const size = ROW_H[props.variant];
	const v = useVirtual(ref, props.tracks.length, size, 8);
	return (
		<ul ref={ref} class={`tracks tracks-${props.variant} tracks-virtual`} aria-label={props.label} style={{ height: `${v.total}px` }}>
			{v.items.map((it) => {
				const t = props.tracks[it.index];
				return <Row key={t.id} {...props} track={t} index={it.index} top={it.start - v.margin} setSize={props.tracks.length} />;
			})}
		</ul>
	);
}

function Row({ track: t, index, onPlay, variant, albumArtist, spans, top, setSize, focusId }: Props & { track: Track; index: number; top?: number; setSize?: number }) {
	const d = dict.value;
	const c = catalog();
	const isCurrent = player.current.value?.id === t.id;
	const isPlaying = isCurrent && player.playing.value;
	const album = c.album.get(t.albumId);
	const s = spans?.get(t.id);
	const showArtist = variant === "list" || (albumArtist !== undefined && t.artist !== albumArtist);
	const label = `${t.title}, ${t.artist}, ${formatTime(t.dur)}`;
	return (
		<li
			class="trow"
			data-current={isCurrent ? "" : undefined}
			data-focus={focusId === t.id ? "" : undefined}
			data-track={t.id}
			style={top !== undefined ? { transform: `translateY(${top}px)` } : undefined}
			aria-posinset={setSize ? index + 1 : undefined}
			aria-setsize={setSize}
		>
			<button type="button" class="trow-hit" aria-label={label} aria-current={isCurrent ? "true" : undefined} onClick={() => onPlay(index)} />
			{variant === "album" ? (
				<span class="trow-lead mono" aria-hidden="true">
					{isCurrent ? <PlayingBars active={isPlaying} /> : <span class="trow-n">{t.n || index + 1}</span>}
					{!isCurrent && <Icon name="play" size={16} class="trow-play" />}
				</span>
			) : (
				<span class="trow-art" aria-hidden="true">
					<Cover albumId={t.albumId} hasCover={!!album?.album.cover} size={44} />
					{isCurrent && (
						<span class="trow-art-state">
							<PlayingBars active={isPlaying} />
						</span>
					)}
				</span>
			)}
			<span class="trow-text" aria-hidden="true">
				<span class="trow-title">
					<Highlight text={t.title} spans={s?.[0]} />
				</span>
				{showArtist && (
					<span class="trow-artist">
						<ArtistLinks text={t.artist} spans={s?.[1]} tabbable={false} />
						{variant === "list" && album && (
							<span class="trow-album-inline">
								{" · "}
								<Highlight text={album.album.title} spans={s?.[2]} />
							</span>
						)}
					</span>
				)}
			</span>
			{variant === "list" && (
				<span class="trow-album" aria-hidden="true">
					{album && <Highlight text={album.album.title} spans={s?.[2]} />}
				</span>
			)}
			<span class="trow-spec mono" aria-hidden="true">
				{trackSpec(t)}
			</span>
			<span class="trow-dur mono" aria-hidden="true">
				{formatTime(t.dur)}
			</span>
			<button type="button" class="trow-more icon-btn" aria-label={`${d.more}: ${t.title}`} aria-haspopup="menu" aria-expanded="false" onClick={(e) => openMenu(e, t.title, trackMenuItems(c, t))}>
				<Icon name="dotsThree" size={20} />
			</button>
		</li>
	);
}
