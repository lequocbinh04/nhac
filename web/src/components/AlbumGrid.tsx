// Album cards. Grids over 50 albums are virtualized by rows; columns follow the container width.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { AlbumInfo } from "../lib/catalog";
import { shortSpec } from "../lib/format";
import { dict } from "../lib/i18n";
import * as player from "../lib/player";
import { href } from "../lib/router";
import type { Span } from "../lib/search";
import { isMobile } from "../lib/ui";
import { useVirtual } from "../lib/virtual";
import { Cover } from "./Cover";
import { Highlight, PlayingBars } from "./bits";
import { Icon } from "./icons";
import { contextMenu } from "./Menu";
import { albumMenuItems } from "./menus";
import { VIRTUALIZE_OVER } from "./TrackList";

/** Card text block: 12px gap + two 21px title lines + 2px + one 20px subtitle line. */
const TEXT_H = 12 + 42 + 2 + 20;

export function AlbumCard({ info, spans, eager }: { info: AlbumInfo; spans?: Span[][]; eager?: boolean }) {
	const d = dict.value;
	const a = info.album;
	const cur = player.current.value;
	const isCurrent = cur?.albumId === a.id;
	const spec = shortSpec(info);
	return (
		<div class="card" data-current={isCurrent ? "" : undefined} {...contextMenu(() => ({ label: a.title, items: albumMenuItems(info) }))}>
			<a class="card-link" href={href.album(a.id)} data-menu-focus>
				<Cover albumId={a.id} hasCover={a.cover} size={176} class="card-cover" eager={eager} />
				<span class="card-title">
					{isCurrent && <PlayingBars active={player.playing.value} />}
					<span class="card-title-text">
						<Highlight text={a.title} spans={spans?.[0]} />
					</span>
				</span>
				<span class="card-sub">
					<span class="card-artist">
						<Highlight text={a.artist} spans={spans?.[1]} />
					</span>
					<span class="card-spec mono" data-tier={info.hiRes ? "hi" : "cd"}>
						{spec}
					</span>
				</span>
			</a>
			<button
				type="button"
				class="card-play"
				aria-label={d.playAlbum(a.title)}
				tabIndex={-1}
				onClick={() => player.playTracks(info.tracks.map((t) => t.id), 0, { shuffle: false })}
			>
				<Icon name="play" size={20} />
			</button>
		</div>
	);
}

function useColumns(ref: { current: HTMLElement | null }) {
	const mobile = isMobile.value;
	const gap = mobile ? 16 : 28;
	const rowGap = mobile ? 24 : 32;
	const min = mobile ? 148 : 176;
	const guess = () => (typeof innerWidth === "number" ? innerWidth - (mobile ? 40 : 232 + 80) : 1100);
	const [width, setWidth] = useState(guess);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => setWidth(el.clientWidth || guess());
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [mobile]);
	const cols = Math.max(2, Math.floor((width + gap) / (min + gap)));
	const card = (width - gap * (cols - 1)) / cols;
	return { cols, gap, rowGap, rowH: Math.round(card + TEXT_H + rowGap) };
}

export function AlbumGrid({ albums, label, spans }: { albums: AlbumInfo[]; label: string; spans?: Map<string, Span[][]> }) {
	const ref = useRef<HTMLDivElement>(null);
	if (albums.length <= VIRTUALIZE_OVER) {
		return (
			<div ref={ref} class="grid" role="list" aria-label={label}>
				{albums.map((info, i) => (
					<div role="listitem" key={info.album.id}>
						<AlbumCard info={info} spans={spans?.get(info.album.id)} eager={i < 10} />
					</div>
				))}
			</div>
		);
	}
	return <VirtualGrid albums={albums} label={label} spans={spans} />;
}

function VirtualGrid({ albums, label, spans }: { albums: AlbumInfo[]; label: string; spans?: Map<string, Span[][]> }) {
	const ref = useRef<HTMLDivElement>(null);
	const { cols, gap, rowH } = useColumns(ref);
	const rows = Math.ceil(albums.length / cols);
	const v = useVirtual(ref, rows, rowH, 2);
	return (
		<div ref={ref} class="vgrid" role="list" aria-label={label} style={{ height: `${v.total}px` }}>
			{v.items.map((row) => (
				<div
					key={row.index}
					class="vgrid-row"
					style={{ transform: `translateY(${row.start - v.margin}px)`, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, columnGap: `${gap}px` }}
				>
					{albums.slice(row.index * cols, row.index * cols + cols).map((info, i) => (
						<div role="listitem" key={info.album.id}>
							<AlbumCard info={info} spans={spans?.get(info.album.id)} eager={row.index * cols + i < cols * 2} />
						</div>
					))}
				</div>
			))}
		</div>
	);
}
