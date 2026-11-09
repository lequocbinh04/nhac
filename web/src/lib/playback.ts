// Pure network policy for the player engine: when an <audio> element may touch the network.

/** Start buffering the next track this many seconds before the current one ends. */
export const PRELOAD_LEAD_S = 45;

/** HTMLMediaElement.HAVE_FUTURE_DATA, inlined so this module has no DOM dependency. */
const HAVE_FUTURE_DATA = 3;

/**
 * `preload` for a track that is loaded but not started (restore after reload, next/previous
 * while paused). "none" means no request at all until the user presses play: restoring a FLAC
 * mid-track would otherwise read the header and then bisect the file to find the saved
 * position (files without a SEEKTABLE), a burst of aborted range requests for nothing.
 */
export function preloadFor(autoplay: boolean): "auto" | "none" {
	return autoplay ? "auto" : "none";
}

export interface PreloadState {
	/** The user wants audio */
	playing: boolean;
	/** Active element is paused */
	paused: boolean;
	readyState: number;
	/** Seconds left in the current track (NaN when unknown) */
	remaining: number;
	/** The next track is a different track (not repeat-one, not end of queue) */
	hasNext: boolean;
	/** The next track is already buffering in the spare element */
	alreadyPreloaded: boolean;
}

/**
 * Buffer the next track only while the current one is actually playing with data in hand, and
 * only near its end. Never while paused or still loading, so a reload or a seek doesn't fan out
 * into requests for two files at once.
 */
export function shouldPreloadNext(s: PreloadState): boolean {
	if (!s.hasNext || s.alreadyPreloaded || !s.playing || s.paused) return false;
	if (s.readyState < HAVE_FUTURE_DATA) return false;
	return s.remaining > 0 && s.remaining <= PRELOAD_LEAD_S;
}
