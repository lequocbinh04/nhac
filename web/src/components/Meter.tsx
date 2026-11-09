// Stereo peak meter with peak hold, fed by real analyser data (lib/meter.ts). Draws only while
// the Now Playing view is open and the meter is on screen; writes transforms directly.
import { useEffect, useRef } from "preact/hooks";
import { dict } from "../lib/i18n";
import { METER_TICKS, meterPosition, readPeaks } from "../lib/meter";
import { onFrame } from "../lib/ticker";

const RELEASE_DB_PER_S = 26;
const HOLD_MS = 1400;
const HOLD_FALL_DB_PER_S = 18;
const FLOOR_DB = -60;

export function LevelMeter({ active }: { active: boolean }) {
	const t = dict.value;
	const root = useRef<HTMLDivElement>(null);
	const fills = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
	const holds = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];

	useEffect(() => {
		const el = root.current;
		if (!active || !el) return;
		let onScreen = true;
		let unsub: (() => void) | null = null;
		const level = [FLOOR_DB, FLOOR_DB];
		const hold = [FLOOR_DB, FLOOR_DB];
		const holdAt = [0, 0];
		const peaks = new Float32Array(2);
		let width = el.querySelector<HTMLElement>(".meter-track")?.clientWidth ?? 0;
		let lastNow = 0;

		const frame = (now: number) => {
			const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
			lastNow = now;
			if (!readPeaks(peaks)) peaks.fill(0);
			for (let c = 0; c < 2; c++) {
				const db = Math.max(FLOOR_DB, 20 * Math.log10(Math.max(peaks[c], 1e-6)));
				level[c] = db >= level[c] ? db : Math.max(db, level[c] - RELEASE_DB_PER_S * dt);
				if (db >= hold[c]) {
					hold[c] = db;
					holdAt[c] = now;
				} else if (now - holdAt[c] > HOLD_MS) {
					hold[c] = Math.max(level[c], hold[c] - HOLD_FALL_DB_PER_S * dt);
				}
				const f = fills[c].current;
				const h = holds[c].current;
				if (f) f.style.transform = `scaleX(${meterPosition(level[c]).toFixed(4)})`;
				if (h) {
					const p = meterPosition(hold[c]);
					h.style.transform = `translateX(${(p * width).toFixed(1)}px)`;
					h.style.opacity = p > 0.001 ? "1" : "0";
				}
			}
		};
		const sync = () => {
			const want = onScreen;
			if (want && !unsub) {
				lastNow = 0;
				unsub = onFrame(frame);
			} else if (!want && unsub) {
				unsub();
				unsub = null;
			}
		};
		const io = new IntersectionObserver((entries) => {
			onScreen = entries[entries.length - 1].isIntersecting;
			sync();
		});
		io.observe(el);
		const ro = new ResizeObserver(() => {
			width = el.querySelector<HTMLElement>(".meter-track")?.clientWidth ?? width;
		});
		ro.observe(el);
		sync();
		return () => {
			io.disconnect();
			ro.disconnect();
			unsub?.();
		};
	}, [active]);

	const row = (c: 0 | 1) => (
		<div class="meter-row">
			<span class="meter-ch mono">{c === 0 ? t.channelL : t.channelR}</span>
			<div class="meter-track">
				<div ref={fills[c]} class="meter-fill" />
				<div ref={holds[c]} class="meter-hold" />
			</div>
		</div>
	);

	return (
		<div ref={root} class="meter" role="img" aria-label={`${t.signalLevel}, ${t.signalScale}`}>
			<div class="panel-head">
				<h3 class="panel-title">{t.signalLevel}</h3>
				<span class="panel-note mono">{t.signalScale}</span>
			</div>
			{row(0)}
			<div class="meter-scale mono" aria-hidden="true">
				{METER_TICKS.map((db) => (
					<span key={db} style={{ left: `${meterPosition(db) * 100}%` }} data-edge={db === -40 ? "start" : db === 0 ? "end" : undefined}>
						{db}
					</span>
				))}
			</div>
			{row(1)}
		</div>
	);
}
