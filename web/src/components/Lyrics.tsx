// Lyrics pane for Now Playing. Synced lyrics follow playback on the shared frame loop: the active
// line is found by binary search and marked with direct attribute writes, and the list moves with
// a compositor transform, so playback never re-renders this component. Manual scrolling (wheel,
// drag, focus) pauses following for a few seconds and offers a way back.
import { useEffect, useMemo, useRef } from "preact/hooks";
import { dict } from "../lib/i18n";
import { activeIndex, lyricRows, type LyricLine } from "../lib/lyrics";
import { lyrics } from "../lib/lyricsStore";
import * as player from "../lib/player";
import { onFrame } from "../lib/ticker";
import { reducedMotion } from "../lib/ui";

/** Where the active line sits, as a fraction of the pane height. */
const ANCHOR = 0.38;
const RESUME_MS = 4000;
const DRAG_SLOP = 6;
const DIM_STEPS = 3;

function SyncedLyrics({ lines, active }: { lines: LyricLine[]; active: boolean }) {
	const t = dict.value;
	const rows = useMemo(() => lyricRows(lines, player.duration.peek()), [lines]);
	const pane = useRef<HTMLDivElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const backBtn = useRef<HTMLButtonElement>(null);
	const resume = useRef<() => void>(() => undefined);

	useEffect(() => {
		const paneEl = pane.current;
		const listEl = list.current;
		if (!active || !paneEl || !listEl) return;
		const els = Array.from(listEl.children) as HTMLElement[];
		let tops: number[] = [];
		let heights: number[] = [];
		let paneH = 0;
		let offset = 0;
		let cur = -2;
		let manual = false;
		let resumeTimer = 0;

		const measure = () => {
			paneH = paneEl.clientHeight;
			tops = els.map((e) => e.offsetTop);
			heights = els.map((e) => e.offsetHeight);
		};
		const targetFor = (i: number) => {
			if (!els.length) return 0;
			const k = Math.max(0, i);
			return tops[k] + heights[k] / 2 - paneH * ANCHOR;
		};
		const apply = (y: number, animate: boolean) => {
			const min = targetFor(0);
			const max = targetFor(els.length - 1);
			offset = Math.min(max, Math.max(min, y));
			listEl.style.transition = animate && !reducedMotion() ? "" : "none";
			listEl.style.transform = `translate3d(0, ${(-offset).toFixed(1)}px, 0)`;
		};
		const mark = (i: number) => {
			for (let k = cur - DIM_STEPS; k <= cur + DIM_STEPS; k++) {
				const e = els[k];
				if (!e) continue;
				delete e.dataset.d;
				delete e.dataset.active;
			}
			for (let k = i - DIM_STEPS; k <= i + DIM_STEPS; k++) {
				const e = els[k];
				if (!e || k === i) continue;
				e.dataset.d = String(Math.abs(k - i));
			}
			if (els[i]) els[i].dataset.active = "";
			cur = i;
		};
		const follow = (animate: boolean) => apply(targetFor(cur), animate);
		const stopManual = () => {
			clearTimeout(resumeTimer);
			manual = false;
			delete backBtn.current?.dataset.show;
			follow(true);
		};
		resume.current = stopManual;
		const startManual = () => {
			manual = true;
			if (backBtn.current) backBtn.current.dataset.show = "";
			clearTimeout(resumeTimer);
			resumeTimer = window.setTimeout(stopManual, RESUME_MS);
		};

		measure();
		mark(activeIndex(rows, player.position()));
		follow(false);

		const unsub = onFrame(() => {
			const i = activeIndex(rows, player.position());
			if (i === cur) return;
			mark(i);
			if (!manual) follow(true);
		});

		const ro = new ResizeObserver(() => {
			measure();
			if (!manual) follow(false);
		});
		ro.observe(paneEl);
		ro.observe(listEl);

		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			startManual();
			apply(offset + e.deltaY, false);
		};
		let dragId: number | null = null;
		let startY = 0;
		let startOffset = 0;
		let moved = false;
		const onDown = (e: PointerEvent) => {
			if (dragId !== null || e.button !== 0) return;
			dragId = e.pointerId;
			startY = e.clientY;
			startOffset = offset;
			moved = false;
		};
		const onMove = (e: PointerEvent) => {
			if (e.pointerId !== dragId) return;
			const dy = e.clientY - startY;
			if (!moved && Math.abs(dy) < DRAG_SLOP) return;
			if (!moved) {
				moved = true;
				paneEl.setPointerCapture(e.pointerId);
			}
			startManual();
			apply(startOffset - dy, false);
		};
		const onUp = (e: PointerEvent) => {
			if (e.pointerId !== dragId) return;
			dragId = null;
			if (!moved) return;
			// A drag is not a tap on the line under the finger.
			const swallow = (ev: Event) => {
				ev.preventDefault();
				ev.stopPropagation();
			};
			paneEl.addEventListener("click", swallow, { capture: true, once: true });
			setTimeout(() => paneEl.removeEventListener("click", swallow, { capture: true }), 0);
		};
		// Keyboard focus on a line brings it into view and pauses following.
		const onFocusIn = (e: FocusEvent) => {
			const i = els.indexOf(e.target as HTMLElement);
			if (i < 0 || i === cur) return;
			startManual();
			apply(targetFor(i), false);
		};
		paneEl.addEventListener("wheel", onWheel, { passive: false });
		paneEl.addEventListener("pointerdown", onDown);
		paneEl.addEventListener("pointermove", onMove);
		paneEl.addEventListener("pointerup", onUp);
		paneEl.addEventListener("pointercancel", onUp);
		paneEl.addEventListener("focusin", onFocusIn);
		return () => {
			unsub();
			ro.disconnect();
			clearTimeout(resumeTimer);
			paneEl.removeEventListener("wheel", onWheel);
			paneEl.removeEventListener("pointerdown", onDown);
			paneEl.removeEventListener("pointermove", onMove);
			paneEl.removeEventListener("pointerup", onUp);
			paneEl.removeEventListener("pointercancel", onUp);
			paneEl.removeEventListener("focusin", onFocusIn);
		};
	}, [rows, active]);

	const seekTo = (time: number) => {
		player.seek(time);
		if (!player.playing.peek()) player.play();
		resume.current();
	};

	return (
		<div ref={pane} class="lyrics lyrics-synced" role="region" aria-label={t.lyrics}>
			<div ref={list} class="lyrics-list">
				{rows.map((r, i) =>
					r.text ? (
						<button key={i} type="button" class="lyric" onClick={() => seekTo(r.time)}>
							{r.text}
						</button>
					) : (
						<div key={i} class="lyric lyric-gap" data-long={r.longGap ? "" : undefined} aria-label={r.longGap ? t.instrumental : undefined} role={r.longGap ? "img" : undefined}>
							{r.longGap && (
								<span class="lyric-dots" aria-hidden="true">
									<i />
									<i />
									<i />
								</span>
							)}
						</div>
					),
				)}
			</div>
			<button ref={backBtn} type="button" class="lyrics-back" onClick={() => resume.current()}>
				{t.lyricsBack}
			</button>
		</div>
	);
}

function PlainLyrics({ lines }: { lines: string[] }) {
	const t = dict.value;
	return (
		<div class="lyrics lyrics-plain" role="region" aria-label={t.lyrics} tabIndex={0}>
			<p class="lyrics-note">{t.lyricsUnsynced}</p>
			{lines.map((l, i) => (l ? <p key={i}>{l}</p> : <p key={i} class="lyrics-break" aria-hidden="true" />))}
		</div>
	);
}

export function LyricsPane({ active }: { active: boolean }) {
	const t = dict.value;
	const st = lyrics.value;
	if (st.status === "loading") return <div class="lyrics lyrics-msg">{t.lyricsLoading}</div>;
	if (st.status === "error") return <div class="lyrics lyrics-msg">{t.lyricsError}</div>;
	if (st.status !== "ready") return null;
	if (st.lyrics.kind === "plain") return <PlainLyrics key={st.id} lines={st.lyrics.lines} />;
	return <SyncedLyrics key={st.id} lines={st.lyrics.lines} active={active} />;
}
