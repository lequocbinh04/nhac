// The login hero: a vinyl record drawn as hairline SVG grooves, regenerated at the current size so
// every stroke is crisp at any DPR. Only `.spin` rotates (a CSS transform animation on its own
// layer), so turning the record never triggers layout or paint.

type Design = {
	/** Innermost groove, outermost groove and where the grooves start fading out (px at scale 1). */
	r0: number;
	r1: number;
	fade: number;
	step: number;
	label: number;
	/** Track separators: radii bands left blank. */
	gaps: [number, number][];
	/** The fixed read point: radius and angle in degrees. */
	arc: number;
	arcAt: number;
};

const DESKTOP: Design = { r0: 132, r1: 820, fade: 430, step: 5, label: 112, gaps: [[300, 311], [462, 476], [618, 628]], arc: 404, arcAt: 150 };
const MOBILE: Design = { r0: 76, r1: 470, fade: 200, step: 4, label: 64, gaps: [[170, 178], [262, 270]], arc: 222, arcAt: 168 };

/** Layout breakpoint shared with login.css. */
const WIDE = 960;

const LABEL_FONT = 10.5;
/** JetBrains Mono advances 0.6em per glyph; tracking stays within 0.08em..0.3em. */
const LABEL_ADVANCE = 0.6;
const LABEL_MIN_TRACKING = 0.08;
const LABEL_MAX_TRACKING = 0.3;
const LABEL_LONG = "NHẠC · LOSSLESS · 24-BIT / 192 KHZ · ";
const LABEL_SHORT = "NHẠC · LOSSLESS · 24/192 · ";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function mulberry32(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Repeats the label as many whole times as the ring holds, then returns the tracking (px) that makes
 * the text close the circle exactly, so the seam is indistinguishable from any other gap.
 */
export function labelText(circumference: number, fontSize = LABEL_FONT): { text: string; tracking: number } {
	const advance = fontSize * LABEL_ADVANCE;
	for (const base of [LABEL_LONG, LABEL_SHORT]) {
		const n = [...base].length;
		const reps = Math.floor(circumference / (n * (advance + fontSize * LABEL_MIN_TRACKING)));
		const tracking = circumference / (n * reps) - advance;
		if (reps >= 1 && (tracking <= fontSize * LABEL_MAX_TRACKING || base === LABEL_SHORT)) return { text: base.repeat(reps), tracking };
	}
	return { text: LABEL_SHORT, tracking: Math.max(0, circumference / [...LABEL_SHORT].length - advance) };
}

function draw(disc: HTMLElement, d: Design, s: number, dpr: number): void {
	const R = d.r1 * s;
	const size = 2 * R;
	const c = R;
	const box = `0 0 ${size.toFixed(1)} ${size.toFixed(1)}`;
	const rnd = mulberry32(d === DESKTOP ? 11 : 23);
	// One device pixel wide at 1x, three quarters of a CSS pixel on dense screens.
	const width = dpr >= 2 ? 0.75 : 1;
	const dim = dpr >= 2 ? 1 : 0.85;

	let rings = "";
	for (let u = d.r0; u <= d.r1; u += d.step) {
		if (d.gaps.some(([a, b]) => u >= a && u <= b)) continue;
		const r = u * s;
		const C = 2 * Math.PI * r;
		// Groove modulation: long runs broken by tiny gaps, which is what makes the rotation legible.
		let dash = "";
		for (let len = 0; len < C / 2; ) {
			const on = (30 + rnd() * 240) * s;
			const off = 1.5 + rnd() * 4;
			dash += `${on.toFixed(1)} ${off.toFixed(1)} `;
			len += on + off;
		}
		const t = clamp((u - d.fade) / (d.r1 - d.fade), 0, 1);
		const alpha = (0.07 + rnd() * 0.1) * (1 - t * t * (3 - 2 * t)) * dim;
		rings += `<circle r="${r.toFixed(1)}" stroke-opacity="${alpha.toFixed(3)}" stroke-dasharray="${dash.trimEnd()}" stroke-dashoffset="${(rnd() * C).toFixed(1)}"/>`;
	}

	const label = d.label * s;
	const tr = label * 0.8;
	const C = 2 * Math.PI * tr;
	const ring = labelText(C);
	const grooves = disc.querySelector<SVGSVGElement>(".grooves")!;
	grooves.setAttribute("viewBox", box);
	grooves.innerHTML =
		`<g transform="translate(${c.toFixed(1)} ${c.toFixed(1)})">` +
		`<g fill="none" stroke="#e6eef1" stroke-width="${width}">${rings}</g>` +
		`<circle class="hub" r="${label.toFixed(1)}"/>` +
		`<path id="disc-label" fill="none" d="M ${-tr} 0 a ${tr} ${tr} 0 1 1 ${2 * tr} 0 a ${tr} ${tr} 0 1 1 ${-2 * tr} 0"/>` +
		`<text class="label-text" letter-spacing="${ring.tracking.toFixed(2)}"><textPath href="#disc-label" textLength="${C.toFixed(1)}" lengthAdjust="spacing">${ring.text}</textPath></text>` +
		`<circle class="spindle" r="${(label * 0.08).toFixed(1)}"/>` +
		`</g>`;

	const arc = 2 * Math.PI * d.arc * s;
	const stylus = disc.querySelector<SVGSVGElement>(".stylus")!;
	stylus.setAttribute("viewBox", box);
	stylus.innerHTML = `<circle cx="${c.toFixed(1)}" cy="${c.toFixed(1)}" r="${(d.arc * s).toFixed(1)}" stroke-dasharray="${(arc * 0.12).toFixed(1)} ${arc.toFixed(1)}" transform="rotate(${d.arcAt} ${c.toFixed(1)} ${c.toFixed(1)})"/>`;

	disc.style.setProperty("--size", `${size.toFixed(1)}px`);
	disc.style.setProperty("--inner", `${((d.label / d.r1) * 100).toFixed(1)}%`);
	disc.style.setProperty("--fade", `${((d.fade / d.r1) * 100).toFixed(1)}%`);
}

/** Draws the record for the current viewport and keeps it in step with resizes and DPR changes. */
export function mountDisc(disc: HTMLElement): void {
	let key = "";
	const update = () => {
		const w = document.documentElement.clientWidth;
		const h = window.innerHeight;
		const dpr = window.devicePixelRatio || 1;
		const wide = w >= WIDE;
		const d = wide ? DESKTOP : MOBILE;
		const s = wide ? clamp(Math.min(w / 1440, h / 900), 0.66, 1.6) : clamp(Math.min(w / 390, (h / 844) * 1.1), 0.8, 1.8);
		const cx = w * (wide ? 0.785 : 0.77);
		const cy = wide ? h / 2 : 236 * s;
		disc.style.setProperty("--cx", `${cx.toFixed(1)}px`);
		disc.style.setProperty("--cy", `${cy.toFixed(1)}px`);
		const next = `${wide}|${s.toFixed(3)}|${dpr >= 2}`;
		if (next === key) return;
		key = next;
		draw(disc, d, s, dpr);
	};
	let frame = 0;
	window.addEventListener("resize", () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(update);
	});
	update();
}
