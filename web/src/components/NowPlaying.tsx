// Now Playing: a full-screen sheet (slides up from the mini player / player bar). On touch it
// follows the finger and dismisses on a flick (velocity > 0.11 px/ms) or a long pull.
import { useEffect, useRef } from "preact/hooks";
import type { Track } from "../lib/types";
import { codecLabel, formatRate, isLossless } from "../lib/format";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import { meterBroken, meterSupport, outputRate } from "../lib/meter";
import * as player from "../lib/player";
import { href, navigate } from "../lib/router";
import { nowPlayingOpen } from "../lib/ui";
import { Cover } from "./Cover";
import { Quality } from "./bits";
import { Icon } from "./icons";
import { LevelMeter } from "./Meter";
import { Seekbar } from "./Seekbar";
import { Time, Transport } from "./Transport";

const FLICK_PX_PER_MS = 0.11;
const PULL_FRACTION = 0.25;
const DRAG_SLOP = 8;

/** Honest path: what we know about the source, the decode, and that the browser owns the output. */
function SignalPath({ track }: { track: Track }) {
	const t = dict.value;
	const lossless = isLossless(track.codec);
	const rate = outputRate.value;
	const steps: { label: string; value: string; detail: string | null; ok?: boolean }[] = [
		{ label: t.pathSource, value: codecLabel(track.codec), detail: `${track.bits > 0 ? `${track.bits}-bit/` : ""}${formatRate(track.sr)} kHz` },
		{ label: t.pathDecode, value: lossless ? t.pathLossless : t.pathLossy, detail: lossless ? t.pathBitExact : null, ok: lossless },
		{ label: t.pathOutput, value: t.pathBrowser, detail: rate ? `${formatRate(rate)} kHz` : null },
	];
	return (
		<div class="sigpath">
			<h3 class="visually-hidden">{t.signalPath}</h3>
			<ol class="sigpath-row">
				{steps.map((s, i) => (
					<li key={s.label} class="sigpath-cell">
						{i > 0 && <Icon name="arrowRight" size={16} class="sigpath-arrow" />}
						<span class="sigpath-text">
							<span class="sigpath-label">{s.label}</span>
							<span class="sigpath-value">{s.value}</span>
							{s.detail && (
								<span class="sigpath-detail mono">
									{s.detail}
									{s.ok && <Icon name="checkCircle" size={14} class="sigpath-ok" />}
								</span>
							)}
						</span>
					</li>
				))}
			</ol>
			<p class="sigpath-note">{lossless ? t.pathNote : t.pathNoteLossy}</p>
		</div>
	);
}

function close() {
	nowPlayingOpen.value = false;
}

export function NowPlaying() {
	const t = dict.value;
	const open = nowPlayingOpen.value;
	const tr = player.current.value;
	const c = catalog();
	const info = tr ? c.album.get(tr.albumId) : undefined;
	const sheet = useRef<HTMLDivElement>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const closeBtn = useRef<HTMLButtonElement>(null);

	// Nothing to show: make sure the sheet is closed.
	useEffect(() => {
		if (!tr && open) close();
	}, [tr, open]);

	// Focus in on open, back to the opener on close; Escape closes.
	useEffect(() => {
		if (!open) {
			const opener = document.querySelector<HTMLElement>("[data-opener]");
			if (opener) {
				delete opener.dataset.opener;
				if (opener.isConnected && opener.offsetParent !== null) opener.focus({ preventScroll: true });
			}
			return;
		}
		closeBtn.current?.focus({ preventScroll: true });
		scroller.current?.scrollTo({ top: 0 });
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented) {
				e.preventDefault();
				close();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	// Drag to dismiss.
	useEffect(() => {
		const el = sheet.current;
		const inner = scroller.current;
		if (!el || !inner) return;
		let id: number | null = null;
		let startY = 0;
		let startX = 0;
		let t0 = 0;
		let dy = 0;
		let dragging = false;

		const reset = () => {
			id = null;
			dragging = false;
		};
		const onDown = (e: PointerEvent) => {
			// Ignore extra fingers once a drag is tracked (multi-touch protection).
			if (id !== null || !nowPlayingOpen.value || e.button !== 0) return;
			if ((e.target as Element).closest(".seek, input, .menu")) return;
			if (e.pointerType === "mouse" && !(e.target as Element).closest(".np-head")) return;
			id = e.pointerId;
			startY = e.clientY;
			startX = e.clientX;
			t0 = e.timeStamp;
			dy = 0;
		};
		const onMove = (e: PointerEvent) => {
			if (e.pointerId !== id) return;
			dy = e.clientY - startY;
			const dx = e.clientX - startX;
			if (!dragging) {
				if (Math.abs(dx) > DRAG_SLOP && Math.abs(dx) > Math.abs(dy)) return reset();
				if (Math.abs(dy) < DRAG_SLOP) return;
				if (inner.scrollTop > 0) return reset();
				dragging = true;
				el.setPointerCapture(e.pointerId);
				el.style.transition = "none";
			}
			// Pulling up past the top is damped: it moves less the further you pull.
			const offset = dy >= 0 ? dy : -Math.sqrt(-dy) * 4;
			el.style.transform = `translateY(${offset}px)`;
		};
		const onUp = (e: PointerEvent) => {
			if (e.pointerId !== id) return;
			const wasDragging = dragging;
			reset();
			if (!wasDragging) return;
			const velocity = dy / Math.max(1, e.timeStamp - t0);
			// The drag ended on a control: swallow the click it would produce (only that one).
			const swallow = (ev: Event) => {
				ev.preventDefault();
				ev.stopPropagation();
			};
			el.addEventListener("click", swallow, { capture: true, once: true });
			setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
			// Hand the position back to CSS: it transitions from here to open or closed.
			el.style.transition = "";
			el.style.transform = "";
			if (dy > 0 && (velocity > FLICK_PX_PER_MS || dy > el.clientHeight * PULL_FRACTION)) close();
		};
		const onCancel = (e: PointerEvent) => {
			if (e.pointerId !== id) return;
			reset();
			el.style.transition = "";
			el.style.transform = "";
		};
		// Keep native scrolling from stealing a downward pull at the top of the sheet.
		let touchY = 0;
		const onTouchStart = (e: TouchEvent) => {
			touchY = e.touches[0]?.clientY ?? 0;
		};
		const onTouchMove = (e: TouchEvent) => {
			const y = e.touches[0]?.clientY ?? 0;
			if (dragging || (id !== null && inner.scrollTop <= 0 && y > touchY)) e.preventDefault();
		};
		el.addEventListener("pointerdown", onDown);
		el.addEventListener("pointermove", onMove);
		el.addEventListener("pointerup", onUp);
		el.addEventListener("pointercancel", onCancel);
		el.addEventListener("touchstart", onTouchStart, { passive: true });
		el.addEventListener("touchmove", onTouchMove, { passive: false });
		return () => {
			el.removeEventListener("pointerdown", onDown);
			el.removeEventListener("pointermove", onMove);
			el.removeEventListener("pointerup", onUp);
			el.removeEventListener("pointercancel", onCancel);
			el.removeEventListener("touchstart", onTouchStart);
			el.removeEventListener("touchmove", onTouchMove);
		};
	}, []);

	const artist = info?.artists[0];
	return (
		<div
			ref={sheet}
			class="np"
			data-open={open ? "" : undefined}
			role="dialog"
			aria-modal="true"
			aria-label={t.nowPlaying}
			aria-hidden={open ? undefined : "true"}
			inert={!open}
		>
			<div ref={scroller} class="np-scroll">
				<header class="np-head">
					<button ref={closeBtn} type="button" class="icon-btn" aria-label={t.closeNowPlaying} onClick={close}>
						<Icon name="caretDown" size={24} />
					</button>
					<span class="np-context">{info?.album.title ?? t.nowPlaying}</span>
					<a
						href={href.queue()}
						class="icon-btn"
						aria-label={t.navQueue}
						onClick={(e) => {
							e.preventDefault();
							close();
							navigate(href.queue(), { keyboard: e.detail === 0 });
						}}
					>
						<Icon name="queue" size={24} />
					</a>
				</header>
				{tr && (
					<div class="np-body">
						<div class="np-art">
							<Cover albumId={tr.albumId} hasCover={!!info?.album.cover} size={480} eager alt={info?.album.title ?? ""} />
						</div>
						<div class="np-side">
							<div class="np-titles">
								<h2 class="np-title">{tr.title}</h2>
								{artist ? (
									<a
										class="np-artist"
										href={href.artist(artist.key)}
										onClick={(e) => {
											e.preventDefault();
											close();
											navigate(href.artist(artist.key), { keyboard: e.detail === 0 });
										}}
									>
										{tr.artist}
									</a>
								) : (
									<span class="np-artist">{tr.artist}</span>
								)}
								<Quality track={tr} />
							</div>
							<div class="np-seek">
								<Seekbar variant="large" />
								<div class="np-times">
									<Time mode="elapsed" />
									<Time mode="remaining" />
								</div>
							</div>
							<Transport size="lg" />
							<section class="np-panel" aria-label={t.signalPath}>
								{meterSupport === "on" && !meterBroken.value && <LevelMeter active={open} />}
								<SignalPath track={tr} />
							</section>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
