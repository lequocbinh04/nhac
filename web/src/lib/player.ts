// Playback engine, independent of any component. Two <audio> elements: the active one plays,
// the spare buffers the next track near the end so `ended` can swap to it with almost no gap.
// State lives in signals (queue, current, playing...); the playback position is read on demand
// (position()) by rAF subscribers instead of being pushed through renders.
import { signal } from "@preact/signals";
import { coverUrl, streamUrl } from "./format";
import { dict } from "./i18n";
import { enableMeter, resumeMeter } from "./meter";
import { loginPath } from "./links";
import { preloadFor, shouldPreloadNext } from "./playback";
import * as Q from "./queue";
import { keepAwake, kick } from "./ticker";
import { toast } from "./toast";
import type { Track } from "./types";

const STORE_KEY = "nhac.player";
/** No progress for this long while playing counts as a stalled stream. */
const STALL_MS = 12_000;
const SAVE_EVERY_MS = 5_000;
const MAX_CONSECUTIVE_FAILURES = 3;

export const queue = signal<Q.QueueState>(Q.emptyQueue);
export const current = signal<Track | null>(null);
/** The user wants audio: true from play until pause, even while buffering. */
export const playing = signal(false);
export const buffering = signal(false);
export const volume = signal(1);
export const muted = signal(false);
/** Duration of the current track in seconds (element value once known, else library value). */
export const duration = signal(0);
/** True once the engine exists and the saved session has been restored. */
export const ready = signal(false);

export interface Resolver {
	track: (id: string) => Track | undefined;
	album: (id: string) => { title: string; cover: boolean } | undefined;
}

let lib: Resolver = { track: () => undefined, album: () => undefined };
const els: HTMLAudioElement[] = [];
let active = 0;
/** Track id buffered in the spare element */
let spareId: string | null = null;
/** Seek to apply once metadata arrives (restore, or seek before load) */
let pendingSeek: number | null = null;
const retried = new Set<string>();
let failures = 0;
let stallTimer = 0;
let lastProgress = 0;
let lastSave = 0;

const activeEl = () => els[active];
const spareEl = () => els[1 - active];

export function position(): number {
	const a = els[active];
	if (!a) return 0;
	return pendingSeek ?? a.currentTime;
}

function trackDuration(): number {
	const a = activeEl();
	return a && Number.isFinite(a.duration) && a.duration > 0 ? a.duration : (current.value?.dur ?? 0);
}

// ---------------------------------------------------------------- persistence

interface Saved {
	v: 1;
	items: string[];
	original: string[] | null;
	index: number;
	shuffle: boolean;
	repeat: Q.Repeat;
	position: number;
	volume: number;
	muted: boolean;
}

function persist() {
	const q = queue.value;
	const saved: Saved = {
		v: 1,
		items: q.items,
		original: q.original,
		index: q.index,
		shuffle: q.shuffle,
		repeat: q.repeat,
		position: Math.round(position() * 10) / 10,
		volume: volume.value,
		muted: muted.value,
	};
	lastSave = Date.now();
	try {
		localStorage.setItem(STORE_KEY, JSON.stringify(saved));
	} catch {
		// Storage full or unavailable: playback continues, it just won't be restored.
	}
}

function restore(): Saved | null {
	try {
		const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Saved | null;
		return s && s.v === 1 && Array.isArray(s.items) ? s : null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------- media session

const ms = typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;

function updateMetadata(t: Track | null) {
	if (!ms) return;
	if (!t) {
		ms.metadata = null;
		return;
	}
	const album = lib.album(t.albumId);
	ms.metadata = new MediaMetadata({
		title: t.title,
		artist: t.artist,
		album: album?.title ?? "",
		artwork: album?.cover ? [{ src: new URL(coverUrl(t.albumId), location.href).href, sizes: "512x512", type: "image/jpeg" }] : [],
	});
}

function updatePositionState() {
	if (!ms?.setPositionState) return;
	const d = trackDuration();
	if (!(d > 0)) return;
	try {
		ms.setPositionState({ duration: d, playbackRate: activeEl()?.playbackRate || 1, position: Math.min(d, Math.max(0, position())) });
	} catch {
		// Some browsers reject transient states (e.g. position during a swap); the next event retries.
	}
}

function setupMediaSession() {
	if (!ms) return;
	const on = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
		try {
			ms.setActionHandler(action, fn);
		} catch {
			// Action not supported by this browser.
		}
	};
	on("play", () => play());
	on("pause", () => pause());
	on("stop", () => pause());
	on("previoustrack", () => prev());
	on("nexttrack", () => next());
	on("seekto", (d) => seek(d.seekTime ?? 0));
	on("seekbackward", (d) => seekBy(-(d.seekOffset ?? 10)));
	on("seekforward", (d) => seekBy(d.seekOffset ?? 10));
}

// ---------------------------------------------------------------- element plumbing

function clearStall() {
	clearTimeout(stallTimer);
	stallTimer = 0;
}

function armStall() {
	if (stallTimer) return;
	stallTimer = window.setTimeout(() => {
		stallTimer = 0;
		const a = activeEl();
		if (playing.value && a.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) fail();
	}, STALL_MS);
}

function maybePreload() {
	const q = queue.value;
	const ni = Q.nextIndex(q, true);
	const id = ni === null || ni === q.index ? null : q.items[ni];
	const a = activeEl();
	const go = shouldPreloadNext({
		playing: playing.value,
		paused: a.paused,
		readyState: a.readyState,
		remaining: trackDuration() - a.currentTime,
		hasNext: id !== null,
		alreadyPreloaded: id !== null && spareId === id,
	});
	if (!go || id === null) return;
	const t = lib.track(id);
	if (!t) return;
	const s = spareEl();
	s.preload = "auto";
	s.src = streamUrl(t.file);
	spareId = id;
}

function dropSpare() {
	const s = spareEl();
	spareId = null;
	if (s.getAttribute("src")) {
		s.pause();
		s.removeAttribute("src");
		s.load();
	}
}

function createAudio(): HTMLAudioElement {
	const a = new Audio();
	a.preload = "none";
	const mine = () => a === activeEl();
	a.addEventListener("playing", () => {
		if (!mine()) return;
		buffering.value = false;
		failures = 0;
		clearStall();
		updatePositionState();
		kick();
	});
	a.addEventListener("play", () => {
		if (!mine()) return;
		if (!playing.value) {
			// Resumed from outside the app (browser media controls).
			playing.value = true;
			keepAwake("playing", true);
		}
		if (ms) ms.playbackState = "playing";
	});
	a.addEventListener("pause", () => {
		// Ignore pauses we caused (src swap) and stale events from a load that already resumed.
		if (!mine() || a.ended || !a.paused || a.readyState === HTMLMediaElement.HAVE_NOTHING) return;
		if (playing.value) {
			// Paused from outside (headphones unplugged, OS controls).
			playing.value = false;
			keepAwake("playing", false);
			persist();
		}
		if (ms) ms.playbackState = "paused";
		kick();
	});
	a.addEventListener("waiting", () => {
		if (!mine() || !playing.value) return;
		buffering.value = true;
		armStall();
	});
	a.addEventListener("stalled", () => {
		if (mine() && playing.value && a.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) armStall();
	});
	a.addEventListener("timeupdate", () => {
		if (!mine()) return;
		if (a.currentTime !== lastProgress) {
			lastProgress = a.currentTime;
			if (stallTimer && !a.paused) clearStall();
		}
		maybePreload();
		if (Date.now() - lastSave > SAVE_EVERY_MS) persist();
	});
	a.addEventListener("loadedmetadata", () => {
		if (!mine()) return;
		if (pendingSeek !== null) {
			const at = pendingSeek;
			pendingSeek = null;
			if (at > 0 && at < a.duration) a.currentTime = at;
		}
		if (Number.isFinite(a.duration) && a.duration > 0) duration.value = a.duration;
		updatePositionState();
		kick();
	});
	a.addEventListener("seeked", () => {
		if (!mine()) return;
		updatePositionState();
		kick();
	});
	a.addEventListener("ended", () => {
		if (mine()) advance(true);
	});
	a.addEventListener("error", () => {
		if (mine()) fail();
		else spareId = null;
	});
	return a;
}

function load(t: Track, autoplay: boolean, at = 0) {
	clearStall();
	buffering.value = false;
	lastProgress = 0;
	if (spareId === t.id && at === 0) {
		const old = activeEl();
		active = 1 - active;
		spareId = null;
		old.pause();
		old.removeAttribute("src");
		old.load();
		pendingSeek = null;
	} else {
		if (spareId) dropSpare();
		const a = activeEl();
		a.preload = preloadFor(autoplay);
		a.src = streamUrl(t.file);
		pendingSeek = at > 0 ? at : null;
	}
	current.value = t;
	duration.value = t.dur;
	updateMetadata(t);
	if (autoplay) startPlayback();
	else if (ms) ms.playbackState = "paused";
	persist();
	kick();
}

function startPlayback() {
	const a = activeEl();
	if (!a.getAttribute("src")) return;
	playing.value = true;
	keepAwake("playing", true);
	resumeMeter();
	a.preload = "auto";
	a.play().catch((err: DOMException) => {
		if (err.name === "NotAllowedError") {
			playing.value = false;
			keepAwake("playing", false);
			toast(dict.value.playBlocked);
		}
		// AbortError: a newer load replaced this one; nothing to do.
	});
}

function stop() {
	const a = activeEl();
	playing.value = false;
	keepAwake("playing", false);
	a.pause();
	if (ms) ms.playbackState = "paused";
}

function advance(auto: boolean) {
	const q = queue.value;
	const i = Q.nextIndex(q, auto);
	if (i === null) {
		// End of the queue: stop on the last track, rewound.
		stop();
		activeEl().currentTime = 0;
		persist();
		kick();
		return;
	}
	if (i === q.index) {
		activeEl().currentTime = 0;
		startPlayback();
		return;
	}
	const t = lib.track(q.items[i]);
	queue.value = Q.jumpTo(q, i);
	if (t) load(t, auto || playing.value);
}

function fail() {
	const t = current.value;
	if (!t) return;
	clearStall();
	const a = activeEl();
	if (!retried.has(t.id)) {
		// Retry once from where we were (network blip, expired connection).
		retried.add(t.id);
		const at = pendingSeek ?? a.currentTime;
		a.src = streamUrl(t.file);
		pendingSeek = at > 0 ? at : null;
		if (playing.value) startPlayback();
		return;
	}
	failures++;
	// A lapsed session also surfaces as a media error: check, and send the user to sign in.
	fetch(streamUrl(t.file), { method: "HEAD", credentials: "same-origin" })
		.then((r) => {
			if (r.status === 401) location.replace(loginPath(location.pathname, location.search));
		})
		.catch(() => undefined);
	if (failures >= MAX_CONSECUTIVE_FAILURES) {
		failures = 0;
		stop();
		toast(dict.value.playStopped);
		return;
	}
	toast(dict.value.playFailed(t.title));
	const q = queue.value;
	const i = Q.nextIndex(q, false);
	if (i === null) {
		stop();
		return;
	}
	queue.value = Q.jumpTo(q, i);
	const nt = lib.track(q.items[i]);
	if (nt) load(nt, playing.value);
}

function applyVolume() {
	for (const a of els) {
		a.volume = volume.value;
		a.muted = muted.value;
	}
}

/** Load whatever the queue says is current (after an edit removed the playing track). */
function syncCurrent(autoplay: boolean) {
	const id = Q.currentId(queue.value);
	if (!id) {
		stop();
		dropSpare();
		activeEl().removeAttribute("src");
		activeEl().load();
		current.value = null;
		duration.value = 0;
		updateMetadata(null);
		persist();
		kick();
		return;
	}
	if (id !== current.value?.id) {
		const t = lib.track(id);
		if (t) load(t, autoplay);
	} else persist();
}

// ---------------------------------------------------------------- public API
// Functions called from UI handlers run inside a user gesture; that is where the level meter
// graph may be created (see meter.ts).

export function initPlayer(resolver: Resolver) {
	lib = resolver;
	if (!els.length) {
		els.push(createAudio(), createAudio());
		setupMediaSession();
		addEventListener("pagehide", persist);
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") persist();
		});
	}
	restoreSaved();
	ready.value = true;
}

function restoreSaved() {
	const saved = restore();
	if (!saved) return;
	volume.value = Math.min(1, Math.max(0, Number(saved.volume) || 0));
	muted.value = !!saved.muted;
	applyVolume();
	const q = Q.sanitize(
		{ items: saved.items, original: saved.original, index: saved.index, shuffle: !!saved.shuffle, repeat: saved.repeat ?? "off" },
		(id) => !!lib.track(id),
	);
	queue.value = q;
	const id = Q.currentId(q);
	const t = id ? lib.track(id) : undefined;
	if (t) load(t, false, id === saved.items[saved.index] ? saved.position : 0);
}

/**
 * Make `ids[start]` the current track, paused at `at` seconds, with the rest as the queue.
 * Nothing is fetched until the user presses play (browsers block autoplay without a gesture).
 */
export function cueTracks(ids: string[], start: number, at = 0) {
	if (!ids.length) return;
	queue.value = Q.replaceQueue(queue.value, ids, start, queue.value.shuffle);
	const t = lib.track(Q.currentId(queue.value) ?? "");
	if (!t) return;
	if (t.id === current.value?.id) seek(at);
	else load(t, false, at);
	persist();
}

/** Replace the queue and start playing. `shuffle` defaults to the current shuffle mode. */
export function playTracks(ids: string[], start = 0, opts: { shuffle?: boolean } = {}) {
	if (!ids.length) return;
	enableMeter(els);
	queue.value = Q.replaceQueue(queue.value, ids, start, opts.shuffle ?? queue.value.shuffle);
	const t = lib.track(Q.currentId(queue.value) ?? "");
	if (!t) return;
	if (t.id === current.value?.id) {
		activeEl().currentTime = 0;
		startPlayback();
		persist();
	} else load(t, true);
}

export function play() {
	if (!current.value) return;
	enableMeter(els);
	startPlayback();
}

export function pause() {
	stop();
	// Let the level meter fall back to silence before the frame loop sleeps.
	keepAwake("decay", true);
	setTimeout(() => keepAwake("decay", false), 1800);
	persist();
	kick();
}

export function toggle() {
	if (playing.value) pause();
	else play();
}

export function next() {
	if (!queue.value.items.length) return;
	enableMeter(els);
	advance(false);
}

export function prev() {
	const q = queue.value;
	if (!q.items.length) return;
	enableMeter(els);
	const p = Q.prevAction(q, position());
	if (p.restart) {
		seek(0);
		return;
	}
	queue.value = Q.jumpTo(q, p.index);
	const t = lib.track(q.items[p.index]);
	if (t) load(t, playing.value);
}

export function seek(seconds: number) {
	const a = activeEl();
	if (!a || !current.value) return;
	const d = trackDuration();
	const at = Math.max(0, d > 0 ? Math.min(seconds, d - 0.05) : seconds);
	if (a.readyState === HTMLMediaElement.HAVE_NOTHING) pendingSeek = at;
	else a.currentTime = at;
	updatePositionState();
	kick();
	if (!playing.value) persist();
}

export function seekBy(delta: number) {
	seek(position() + delta);
}

export function setVolume(v: number) {
	volume.value = Math.min(1, Math.max(0, v));
	if (volume.value > 0 && muted.value) muted.value = false;
	applyVolume();
	persist();
}

export function toggleMute() {
	muted.value = !muted.value;
	applyVolume();
	persist();
}

export function toggleShuffle() {
	queue.value = Q.setShuffle(queue.value, !queue.value.shuffle);
	persist();
}

export function cycleRepeat() {
	queue.value = { ...queue.value, repeat: Q.cycleRepeat(queue.value.repeat) };
	persist();
}

/** Play the queue item at `index`. */
export function jump(index: number) {
	const q = Q.jumpTo(queue.value, index);
	const t = lib.track(Q.currentId(q) ?? "");
	if (!t) return;
	enableMeter(els);
	queue.value = q;
	if (t.id === current.value?.id) play();
	else load(t, true);
}

export function removeAt(index: number) {
	queue.value = Q.removeAt(queue.value, index);
	syncCurrent(playing.value);
}

export function moveItem(from: number, to: number) {
	queue.value = Q.move(queue.value, from, to);
	persist();
}

export function clearUpcoming() {
	queue.value = Q.clearUpcoming(queue.value);
	persist();
}

export function playNext(ids: string[]) {
	const wasEmpty = !current.value;
	queue.value = Q.playNext(queue.value, ids);
	if (wasEmpty) syncCurrent(false);
	else persist();
}

export function addToQueue(ids: string[]) {
	const wasEmpty = !current.value;
	queue.value = Q.append(queue.value, ids);
	if (wasEmpty) syncCurrent(false);
	else persist();
}
