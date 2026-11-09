// Waveform seek bar. The waveform is drawn once per track (and on resize) from library peaks;
// the played portion is the same drawing in the accent colour, revealed by two opposing
// translateX transforms so progress updates never repaint. Without peaks: a thin track bar.
import { useComputed } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { formatTime } from "../lib/format";
import { dict } from "../lib/i18n";
import { decodePeaks, resamplePeaks } from "../lib/peaks";
import * as player from "../lib/player";
import { kick, onFrame } from "../lib/ticker";

interface Props {
	variant: "bar" | "large";
}

const GEOMETRY = {
	bar: { bar: 2, gap: 1.5, height: 18 },
	large: { bar: 3, gap: 2, height: 40 },
};

function readColor(el: Element, prop: string): string {
	return getComputedStyle(el).getPropertyValue(prop).trim() || "#888";
}

function draw(canvas: HTMLCanvasElement, values: Float32Array, color: string, g: (typeof GEOMETRY)["bar"]) {
	const dpr = Math.min(3, window.devicePixelRatio || 1);
	const w = canvas.clientWidth;
	const h = g.height;
	canvas.width = Math.round(w * dpr);
	canvas.height = Math.round(h * dpr);
	const c = canvas.getContext("2d");
	if (!c) return;
	c.setTransform(dpr, 0, 0, dpr, 0, 0);
	c.clearRect(0, 0, w, h);
	c.fillStyle = color;
	const pitch = g.bar + g.gap;
	for (let i = 0; i < values.length; i++) {
		const bh = Math.max(2, Math.round(values[i] * h));
		const x = i * pitch;
		const y = (h - bh) / 2;
		c.beginPath();
		if (c.roundRect) c.roundRect(x, y, g.bar, bh, 1);
		else c.rect(x, y, g.bar, bh);
		c.fill();
	}
}

export function Seekbar({ variant }: Props) {
	const t = dict.value;
	const track = player.current.value;
	const peaks = useComputed(() => decodePeaks(player.current.value?.peaks));
	const hasPeaks = !!peaks.value;
	const root = useRef<HTMLDivElement>(null);
	const base = useRef<HTMLCanvasElement>(null);
	const played = useRef<HTMLCanvasElement>(null);
	const clip = useRef<HTMLDivElement>(null);
	const fill = useRef<HTMLDivElement>(null);
	const drag = useRef<number | null>(null);
	const g = GEOMETRY[variant];

	// Draw the waveform whenever the track or the width changes.
	useLayoutEffect(() => {
		const el = root.current;
		const p = peaks.value;
		if (!el || !p || !base.current || !played.current) return;
		const paint = () => {
			const w = el.clientWidth;
			if (!w || !base.current || !played.current) return;
			const bars = Math.max(8, Math.floor((w + g.gap) / (g.bar + g.gap)));
			const values = resamplePeaks(p, bars);
			draw(base.current, values, readColor(el, "--wave-base"), g);
			draw(played.current, values, readColor(el, "--wave-played"), g);
		};
		paint();
		const ro = new ResizeObserver(paint);
		ro.observe(el);
		return () => ro.disconnect();
	}, [peaks.value, variant]);

	// Progress: direct transform writes on the shared frame loop.
	useEffect(() => {
		let last = -1;
		let lastSecond = -1;
		return onFrame(() => {
			const el = root.current;
			if (!el) return;
			const d = player.duration.value;
			const pos = drag.current ?? player.position();
			const p = d > 0 ? Math.min(1, Math.max(0, pos / d)) : 0;
			if (Math.abs(p - last) > 0.0004) {
				last = p;
				if (clip.current) {
					const off = (1 - p) * 100;
					clip.current.style.transform = `translateX(-${off}%)`;
					(clip.current.firstElementChild as HTMLElement).style.transform = `translateX(${off}%)`;
				}
				if (fill.current) fill.current.style.transform = `scaleX(${p})`;
			}
			const s = Math.floor(pos);
			if (s !== lastSecond) {
				lastSecond = s;
				el.setAttribute("aria-valuenow", String(s));
				el.setAttribute("aria-valuetext", `${formatTime(pos)} / ${formatTime(d)}`);
			}
		});
	}, []);

	const fraction = (e: PointerEvent) => {
		const r = root.current!.getBoundingClientRect();
		return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
	};
	const onPointerDown = (e: PointerEvent) => {
		if (!track || e.button !== 0) return;
		e.preventDefault();
		root.current!.setPointerCapture(e.pointerId);
		root.current!.focus({ preventScroll: true });
		drag.current = fraction(e) * player.duration.value;
		root.current!.dataset.dragging = "";
		kick();
	};
	const onPointerMove = (e: PointerEvent) => {
		if (drag.current === null) return;
		drag.current = fraction(e) * player.duration.value;
		kick();
	};
	const onPointerUp = (e: PointerEvent) => {
		if (drag.current === null) return;
		const at = fraction(e) * player.duration.value;
		drag.current = null;
		delete root.current!.dataset.dragging;
		player.seek(at);
	};
	const onPointerCancel = () => {
		drag.current = null;
		if (root.current) delete root.current.dataset.dragging;
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (!track) return;
		const d = player.duration.value;
		const step = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 }[e.key];
		if (step !== undefined) player.seekBy(step);
		else if (e.key === "Home") player.seek(0);
		else if (e.key === "End") player.seek(d);
		else return;
		e.preventDefault();
		e.stopPropagation();
	};

	return (
		<div
			ref={root}
			class={`seek seek-${variant}`}
			data-peaks={hasPeaks ? "" : undefined}
			data-empty={track ? undefined : ""}
			role="slider"
			tabIndex={track ? 0 : -1}
			aria-label={t.seek}
			aria-valuemin={0}
			aria-valuemax={Math.floor(player.duration.value)}
			aria-valuenow={0}
			aria-disabled={track ? undefined : "true"}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			onKeyDown={onKeyDown}
			style={{ "--seek-h": `${g.height}px` }}
		>
			{hasPeaks ? (
				<>
					<canvas ref={base} class="seek-wave" aria-hidden="true" />
					<div ref={clip} class="seek-clip" aria-hidden="true">
						<div class="seek-clip-inner">
							<canvas ref={played} class="seek-wave" />
						</div>
					</div>
				</>
			) : (
				<div class="seek-line" aria-hidden="true">
					<div ref={fill} class="seek-fill" />
				</div>
			)}
		</div>
	);
}
