import { useRef, useState } from "preact/hooks";
import { Cover } from "../components/Cover";
import { Empty, PlayingBars } from "../components/bits";
import { Icon } from "../components/icons";
import { formatTime, trackSpec } from "../lib/format";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import * as player from "../lib/player";
import { href } from "../lib/router";
import type { Track } from "../lib/types";
import { useVirtual } from "../lib/virtual";

const ROW_H = 64;

interface Drag {
	from: number;
	to: number;
}

function QueueRow({
	track,
	qi,
	top,
	current,
	onHandleDown,
	setSize,
	pos,
}: {
	track: Track;
	qi: number;
	top: number;
	current?: boolean;
	onHandleDown?: (e: PointerEvent, qi: number) => void;
	setSize?: number;
	pos?: number;
}) {
	const t = dict.value;
	const c = catalog();
	const info = c.album.get(track.albumId);
	const onKeyDown = (e: KeyboardEvent) => {
		if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
		e.preventDefault();
		const q = player.queue.value;
		const to = qi + (e.key === "ArrowUp" ? -1 : 1);
		if (to <= q.index || to >= q.items.length) return;
		player.moveItem(qi, to);
		requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-qi="${to}"] .qrow-hit`)?.focus());
	};
	return (
		<li
			class="qrow"
			data-qi={qi}
			data-current={current ? "" : undefined}
			style={{ transform: `translateY(${top}px)` }}
			aria-posinset={pos}
			aria-setsize={setSize}
			onKeyDown={current ? undefined : onKeyDown}
		>
			{onHandleDown ? (
				<span class="qrow-handle" aria-hidden="true" onPointerDown={(e) => onHandleDown(e, qi)}>
					<Icon name="dotsSixVertical" size={18} />
				</span>
			) : (
				<span class="qrow-handle qrow-handle-static" aria-hidden="true">
					<PlayingBars active={player.playing.value} />
				</span>
			)}
			<button
				type="button"
				class="qrow-hit"
				aria-label={`${track.title}, ${track.artist}`}
				aria-describedby={current ? undefined : "queue-reorder-hint"}
				aria-current={current ? "true" : undefined}
				onClick={() => (current ? player.toggle() : player.jump(qi))}
			/>
			<Cover albumId={track.albumId} hasCover={!!info?.album.cover} size={44} />
			<span class="trow-text" aria-hidden="true">
				<span class="trow-title">{track.title}</span>
				<span class="trow-artist">{track.artist}</span>
			</span>
			<span class="trow-spec mono" aria-hidden="true">
				{trackSpec(track)}
			</span>
			<span class="trow-dur mono" aria-hidden="true">
				{formatTime(track.dur)}
			</span>
			<button type="button" class="icon-btn qrow-remove" aria-label={`${t.remove}: ${track.title}`} onClick={() => player.removeAt(qi)}>
				<Icon name="x" size={18} />
			</button>
		</li>
	);
}

function UpNext({ items, start }: { items: string[]; start: number }) {
	const c = catalog();
	const ref = useRef<HTMLUListElement>(null);
	const v = useVirtual(ref, items.length, ROW_H, 6);
	const [drag, setDrag] = useState<Drag | null>(null);
	const dragRef = useRef<{ id: number; startY: number; row: HTMLElement; base: number; from: number; to: number } | null>(null);

	const onHandleDown = (e: PointerEvent, qi: number) => {
		if (e.button !== 0 || dragRef.current) return;
		e.preventDefault();
		const handle = e.currentTarget as HTMLElement;
		const row = handle.closest<HTMLElement>(".qrow");
		if (!row) return;
		handle.setPointerCapture(e.pointerId);
		const base = (qi - start) * ROW_H;
		dragRef.current = { id: e.pointerId, startY: e.clientY, row, base, from: qi, to: qi };
		row.dataset.dragging = "";
		// On drop, settle into the target slot (where the reordered render will also put it).
		const settle = (to: number) => {
			row.style.transform = `translateY(${(to - start) * ROW_H}px)`;
		};
		setDrag({ from: qi, to: qi });
		const move = (ev: PointerEvent) => {
			const d = dragRef.current;
			if (!d || ev.pointerId !== d.id) return;
			const dy = ev.clientY - d.startY;
			d.row.style.transform = `translateY(${d.base + dy}px)`;
			const to = Math.min(start + items.length - 1, Math.max(start, d.from + Math.round(dy / ROW_H)));
			if (to !== d.to) {
				d.to = to;
				setDrag({ from: d.from, to });
			}
		};
		const up = (ev: PointerEvent) => {
			const d = dragRef.current;
			if (!d || ev.pointerId !== d.id) return;
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", up);
			handle.removeEventListener("pointercancel", up);
			delete d.row.dataset.dragging;
			settle(ev.type === "pointerup" ? d.to : d.from);
			dragRef.current = null;
			setDrag(null);
			if (ev.type === "pointerup" && d.to !== d.from) player.moveItem(d.from, d.to);
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", up);
		handle.addEventListener("pointercancel", up);
	};

	const shift = (qi: number) => {
		if (!drag || qi === drag.from) return 0;
		if (drag.from < drag.to && qi > drag.from && qi <= drag.to) return -ROW_H;
		if (drag.from > drag.to && qi >= drag.to && qi < drag.from) return ROW_H;
		return 0;
	};

	return (
		<ul ref={ref} class="queue-list" data-dragging={drag ? "" : undefined} style={{ height: `${v.total}px` }}>
			{v.items.map((it) => {
				const qi = start + it.index;
				const tr = c.track.get(items[it.index]);
				if (!tr) return null;
				const top = it.start - v.margin;
				return (
					<QueueRow
						key={tr.id}
						track={tr}
						qi={qi}
						top={top + shift(qi)}
						onHandleDown={onHandleDown}
						pos={it.index + 1}
						setSize={items.length}
					/>
				);
			})}
		</ul>
	);
}

export function QueueView() {
	const t = dict.value;
	const q = player.queue.value;
	const cur = player.current.value;
	const upcoming = q.items.slice(q.index + 1);

	return (
		<div class="page queue-page">
			<div class="page-head">
				<h1 class="page-title" tabIndex={-1}>
					{t.queueTitle}
				</h1>
				{upcoming.length > 0 && (
					<button type="button" class="pill" onClick={() => player.clearUpcoming()}>
						<Icon name="x" size={16} />
						<span>{t.clearQueue}</span>
					</button>
				)}
			</div>
			{!cur ? (
				<Empty title={t.queueEmpty} body={t.queueEmptyBody}>
					<a class="btn" href={href.albums()}>
						{t.browseAlbums}
					</a>
				</Empty>
			) : (
				<>
					<section class="section">
						<h2 class="section-title">{t.nowPlaying}</h2>
						<ul class="queue-list queue-current" style={{ height: `${ROW_H}px` }}>
							<QueueRow track={cur} qi={q.index} top={0} current />
						</ul>
					</section>
					<section class="section">
						<div class="section-head">
							<h2 class="section-title">
								{t.upNext}
								{upcoming.length > 0 && <span class="section-count mono"> {t.countTracks(upcoming.length)}</span>}
							</h2>
						</div>
						<p id="queue-reorder-hint" class="visually-hidden">
							{t.reorder}
						</p>
						{upcoming.length ? <UpNext items={upcoming} start={q.index + 1} /> : <p class="muted">{t.queueNothingNext}</p>}
					</section>
				</>
			)}
		</div>
	);
}
