// Transport controls and live time readouts shared by the player bar, mini player and Now Playing.
import { useEffect, useRef } from "preact/hooks";
import { formatTime } from "../lib/format";
import { dict } from "../lib/i18n";
import * as player from "../lib/player";
import { onFrame } from "../lib/ticker";
import { Icon } from "./icons";

/** Elapsed / remaining time written straight to the DOM, only when the second changes. */
export function Time({ mode, class: cls = "" }: { mode: "elapsed" | "remaining" | "total"; class?: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		let last = "";
		return onFrame(() => {
			const d = player.duration.value;
			const p = player.position();
			const text = mode === "elapsed" ? formatTime(p) : mode === "total" ? formatTime(d) : `-${formatTime(Math.max(0, d - Math.floor(p)))}`;
			if (text !== last && ref.current) {
				last = text;
				ref.current.textContent = text;
			}
		});
	}, [mode]);
	return <span ref={ref} class={`time mono ${cls}`} aria-hidden="true" />;
}

export function PlayButton({ size }: { size: "sm" | "md" | "lg" }) {
	const t = dict.value;
	const on = player.playing.value;
	const disabled = !player.current.value;
	const icon = size === "lg" ? 30 : 22;
	return (
		<button
			type="button"
			class={`play-btn play-${size}`}
			aria-label={on ? t.pause : t.play}
			data-buffering={on && player.buffering.value ? "" : undefined}
			disabled={disabled}
			onClick={() => player.toggle()}
		>
			<Icon name={on ? "pause" : "play"} size={icon} />
		</button>
	);
}

export function Transport({ size }: { size: "md" | "lg" }) {
	const t = dict.value;
	const q = player.queue.value;
	const disabled = !player.current.value;
	const big = size === "lg";
	const repeatLabel = q.repeat === "one" ? t.repeatOne : q.repeat === "all" ? t.repeatAll : t.repeatOff;
	return (
		<div class={`transport transport-${size}`}>
			<button
				type="button"
				class="icon-btn toggle"
				aria-pressed={q.shuffle}
				aria-label={t.shuffle}
				title={q.shuffle ? t.shuffleOn : t.shuffleOff}
				onClick={() => player.toggleShuffle()}
			>
				<Icon name="shuffle" size={big ? 24 : 19} />
			</button>
			<button type="button" class="icon-btn strong" aria-label={t.previous} disabled={disabled} onClick={() => player.prev()}>
				<Icon name="skipBack" size={big ? 30 : 22} />
			</button>
			<PlayButton size={big ? "lg" : "md"} />
			<button type="button" class="icon-btn strong" aria-label={t.next} disabled={disabled} onClick={() => player.next()}>
				<Icon name="skipForward" size={big ? 30 : 22} />
			</button>
			<button
				type="button"
				class="icon-btn toggle"
				aria-pressed={q.repeat !== "off"}
				aria-label={repeatLabel}
				title={repeatLabel}
				onClick={() => player.cycleRepeat()}
			>
				<Icon name={q.repeat === "one" ? "repeatOnce" : "repeat"} size={big ? 24 : 19} />
			</button>
		</div>
	);
}
