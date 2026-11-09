// Small shared pieces: highlighted text, playing indicator, quality readout, spec text.
import type { ComponentChildren } from "preact";
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
