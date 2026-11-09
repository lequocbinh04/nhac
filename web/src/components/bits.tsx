// Small shared pieces: highlighted text, artist credits, playing indicator, quality readout.
import type { ComponentChildren } from "preact";
import { artistSegments } from "../lib/catalog";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import { describeQuality } from "../lib/quality";
import { href } from "../lib/router";
import { highlightParts, type Span } from "../lib/search";
import { qualityParts } from "../lib/format";
import type { Track } from "../lib/types";

export function Highlight({ text, spans }: { text: string; spans?: Span[] }) {
	if (!spans?.length) return <>{text}</>;
	return (
		<>
			{highlightParts(text, spans).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}
		</>
	);
}

/**
 * An artist credit exactly as tagged ("Ferro & Lune", "A feat. B"), with each recognised name
 * linking to its artist page. `spans` highlight positions in the whole string (search).
 * `tabbable={false}` keeps links out of the tab order inside rows that already have one action
 * (keyboard users reach the artist through the row's menu instead).
 */
export function ArtistLinks({ text, spans, tabbable = true, onNavigate }: { text: string; spans?: Span[]; tabbable?: boolean; onNavigate?: () => void }) {
	const c = catalog();
	let pos = 0;
	return (
		<>
			{artistSegments(text).map((seg, i) => {
				const start = pos;
				const end = (pos += seg.text.length);
				const local = spans
					?.filter(([s, e]) => s < end && e > start)
					.map(([s, e]): Span => [Math.max(s, start) - start, Math.min(e, end) - start]);
				const inner = <Highlight text={seg.text} spans={local} />;
				const artist = seg.key ? c.artist.get(seg.key) : undefined;
				if (!artist) return <span key={i}>{inner}</span>;
				return (
					<a key={i} class="artist-link" href={href.artist(artist.key)} tabIndex={tabbable ? undefined : -1} onClick={onNavigate}>
						{inner}
					</a>
				);
			})}
		</>
	);
}

/** Three-bar indicator for the playing item. Moves only while audio plays. */
export function PlayingBars({ active }: { active: boolean }) {
	return (
		<span class="bars" data-active={active ? "" : undefined} aria-hidden="true">
			<span />
			<span />
			<span />
		</span>
	);
}

/** "FLAC │ 24 bit │ 192 kHz" */
export function Quality({ track, live = true }: { track: Pick<Track, "bits" | "sr" | "codec">; live?: boolean }) {
	const q = qualityParts(track);
	return (
		<span class="quality mono" data-live={live ? "" : undefined}>
			<span class="quality-codec">{q.codec}</span>
			{q.bits !== null && (
				<>
					<span class="quality-sep" aria-hidden="true" />
					<span class="quality-cell">
						<span class="quality-num">{q.bits}</span>
						<span class="quality-unit">bit</span>
					</span>
				</>
			)}
			<span class="quality-sep" aria-hidden="true" />
			<span class="quality-cell">
				<span class="quality-num">{q.khz}</span>
				<span class="quality-unit">kHz</span>
			</span>
		</span>
	);
}

/**
 * Authenticity verdict beside the quality readout: "● Lossless", "● Upsampled · 44.1k source",
 * "● Lossy source · ~16 kHz". Nothing when inconclusive or not analysed. `compact` keeps the label
 * only (the detail stays in the tooltip and the accessible text).
 */
export function Verdict({ track, compact = false }: { track: Pick<Track, "quality" | "sr" | "bits">; compact?: boolean }) {
	const q = describeQuality(track, dict.value);
	if (!q || q.verdict === "unknown") return null;
	return (
		<span class="verdict" data-v={q.verdict} title={q.why}>
			<span class="verdict-dot" aria-hidden="true" />
			<span>{q.label}</span>
			{q.detail && !compact && <span class="verdict-detail">· {q.detail}</span>}
			<span class="visually-hidden">
				{compact && q.detail ? `, ${q.detail}` : ""}. {q.why}
			</span>
		</span>
	);
}

export function Empty({ title, body, children, icon }: { title: string; body?: string; children?: ComponentChildren; icon?: ComponentChildren }) {
	return (
		<div class="empty" role="status">
			{icon && <span class="empty-icon">{icon}</span>}
			<h2 class="empty-title">{title}</h2>
			{body && <p class="empty-body">{body}</p>}
			{children && <div class="empty-actions">{children}</div>}
		</div>
	);
}
