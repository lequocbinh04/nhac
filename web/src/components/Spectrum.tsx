// Spectrogram pane for Now Playing. The image comes from the library scan (whole track on x, 0 Hz at
// the bottom to Nyquist at the top, no axes baked in); axes, the detected cutoff and the playhead are
// drawn here in HTML so they stay crisp. The playhead follows playback on the shared frame loop with
// a transform only: playback never re-renders this component. A click or tap on the image seeks.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { dict } from "../lib/i18n";
import * as player from "../lib/player";
import { describeQuality, formatKhz, freqTicks, timeTicks } from "../lib/quality";
import { kick, onFrame } from "../lib/ticker";
import type { Track } from "../lib/types";
import { Verdict } from "./bits";

/** Image already decoded when mounted (cache, keyboard toggle) shows without a fade. */
type ImageState = "loading" | "fading" | "instant" | "error";

/** Cutoff labels flip under the line when it runs this close to the top edge. */
const FLIP_AT = 0.82;

export function SpectrumPane({ track, active }: { track: Track; active: boolean }) {
	const t = dict.value;
	const q = describeQuality(track, t);
	const nyquist = track.sr / 2;
	const fTicks = useMemo(() => freqTicks(nyquist), [nyquist]);
	const tTicks = useMemo(() => timeTicks(track.dur), [track.dur]);
	const frame = useRef<HTMLDivElement>(null);
	const head = useRef<HTMLDivElement>(null);
	const img = useRef<HTMLImageElement>(null);
	const [image, setImage] = useState<ImageState>("loading");

	useLayoutEffect(() => {
		const el = img.current;
		if (el?.complete && el.naturalWidth > 0) setImage("instant");
	}, []);

	useEffect(() => {
		const box = frame.current;
		const line = head.current;
		if (!active || !box || !line) return;
		let width = box.clientWidth;
		let last = -1;
		const ro = new ResizeObserver(() => {
			width = box.clientWidth;
			last = -1;
			kick();
		});
		ro.observe(box);
		const unsub = onFrame(() => {
			const d = player.duration.peek() || track.dur;
			const p = d > 0 ? Math.min(1, Math.max(0, player.position() / d)) : 0;
			const x = Math.round(p * width * 2) / 2;
			if (x === last) return;
			last = x;
			line.style.transform = `translate3d(${x}px, 0, 0)`;
		});
		return () => {
			unsub();
			ro.disconnect();
		};
	}, [active, track.dur]);

	const onClick = (e: MouseEvent) => {
		const r = frame.current?.getBoundingClientRect();
		const d = player.duration.peek() || track.dur;
		if (!r || r.width <= 0 || !(d > 0)) return;
		player.seek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * d);
	};

	const cut = track.quality?.cutoffHz ?? 0;
	const cutAt = nyquist > 0 ? cut / nyquist : 0;
	const pct = (at: number) => `${(at * 100).toFixed(3)}%`;

	return (
		<section class="spec" aria-label={t.spectrum}>
			{q && q.verdict !== "unknown" && (
				<div class="spec-summary">
					<Verdict track={track} />
				</div>
			)}
			<p class="spec-why">{q ? q.why : t.qNotAnalysed}</p>
			<div class="spec-plot">
				<span class="spec-unit mono" aria-hidden="true">
					kHz
				</span>
				<div class="spec-y mono" aria-hidden="true">
					{fTicks.map((tk) => (
						<span key={tk.label} style={{ bottom: pct(tk.at) }} data-edge={tk.edge ? "top" : tk.at === 0 ? "bottom" : undefined}>
							{tk.label}
						</span>
					))}
				</div>
				<div
					ref={frame}
					class="spec-frame"
					role="img"
					aria-label={t.spectrumAlt(formatKhz(nyquist, 2), q?.why ?? "")}
					title={t.spectrumSeek}
					data-image={image}
					onClick={onClick}
				>
					<img
						ref={img}
						src={`/spectrum/${encodeURIComponent(track.id)}`}
						alt=""
						width={1200}
						height={400}
						loading="lazy"
						decoding="async"
						draggable={false}
						onLoad={() => setImage((s) => (s === "instant" ? s : "fading"))}
						onError={() => setImage("error")}
					/>
					<div class="spec-grid" aria-hidden="true">
						{fTicks
							.filter((tk) => tk.at > 0 && !tk.edge)
							.map((tk) => (
								<i key={tk.label} style={{ bottom: pct(tk.at) }} />
							))}
					</div>
					{cutAt > 0 && cutAt < 0.99 && (
						<div class="spec-cut" data-v={q?.verdict} data-flip={cutAt > FLIP_AT ? "" : undefined} style={{ bottom: pct(cutAt) }} aria-hidden="true">
							<span class="spec-cut-label mono">{formatKhz(cut)} kHz</span>
						</div>
					)}
					<div ref={head} class="spec-playhead" aria-hidden="true" />
					{image === "error" && <span class="spec-msg">{t.spectrumError}</span>}
				</div>
				<div class="spec-x mono" aria-hidden="true">
					{tTicks.map((tk) => (
						<span key={tk.label} style={{ left: pct(tk.at) }} data-edge={tk.at === 0 ? "start" : undefined}>
							{tk.label}
						</span>
					))}
				</div>
			</div>
		</section>
	);
}
