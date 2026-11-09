// One requestAnimationFrame loop for everything that moves with playback (progress, time, meter).
// Subscribers write the DOM directly; nothing here re-renders components. The loop only runs
// while some reason keeps it awake (playing, dragging, meter decay) and the tab is visible.

type FrameFn = (now: number) => void;

const subs = new Set<FrameFn>();
const awake = new Set<string>();
let raf = 0;
let pendingKick = false;

function frame(now: number) {
	raf = 0;
	pendingKick = false;
	for (const fn of subs) fn(now);
	if (shouldRun()) raf = requestAnimationFrame(frame);
}

function shouldRun(): boolean {
	return awake.size > 0 && subs.size > 0 && document.visibilityState === "visible";
}

function ensure() {
	if (!raf && (shouldRun() || pendingKick)) raf = requestAnimationFrame(frame);
}

export function onFrame(fn: FrameFn): () => void {
	subs.add(fn);
	kick();
	return () => subs.delete(fn);
}

/** Keep the loop running while `on` for this reason. */
export function keepAwake(reason: string, on: boolean) {
	if (on) awake.add(reason);
	else awake.delete(reason);
	ensure();
}

/** Run subscribers once on the next frame (after a seek, pause or track change). */
export function kick() {
	pendingKick = true;
	ensure();
}

if (typeof document !== "undefined") {
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") kick();
	});
}
