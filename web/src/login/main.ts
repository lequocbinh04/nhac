import "@fontsource-variable/inter/wght.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/vietnamese-400.css";
import "../styles/tokens.css";
import "./login.css";
import { localize, t, type Key } from "./i18n";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const root = document.documentElement;
const form = $<HTMLFormElement>("login");
const input = $<HTMLInputElement>("password");
const field = $<HTMLDivElement>("field");
const reveal = $<HTMLButtonElement>("reveal");
const submit = $<HTMLButtonElement>("submit");
const submitLabel = submit.querySelector<HTMLElement>(".submit-label")!;
const caps = $<HTMLSpanElement>("caps");
const error = $<HTMLSpanElement>("error");
const errorText = $<HTMLSpanElement>("error-text");
const art = document.querySelector<HTMLElement>(".art")!;
const artImg = art.querySelector("img")!;

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

localize();

// Entrance: the form rises as soon as this runs; the art waits until its pixels are decoded
// (capped) so it never fades in as an empty box.
requestAnimationFrame(() => root.classList.replace("is-pending", "is-in"));
const showArt = () => art.classList.add("is-loaded");
if (artImg.complete) showArt();
else {
	artImg.decode().then(showArt, showArt);
	setTimeout(showArt, 900);
}

// The ambient drift is a CSS animation; stop it entirely while the tab is hidden.
const syncVisibility = () => root.toggleAttribute("data-hidden", document.visibilityState === "hidden");
document.addEventListener("visibilitychange", syncVisibility);
syncVisibility();

// Desktop only: autofocus would pop the keyboard over the art on touch devices.
if (finePointer.matches) input.focus({ preventScroll: true });

reveal.addEventListener("click", () => {
	const shown = reveal.getAttribute("aria-pressed") !== "true";
	reveal.setAttribute("aria-pressed", String(shown));
	reveal.setAttribute("aria-label", t(shown ? "hide" : "show"));
	input.type = shown ? "text" : "password";
	// Keep the caret where it was so the toggle doesn't interrupt typing.
	const { selectionStart, selectionEnd } = input;
	input.focus({ preventScroll: true });
	input.setSelectionRange(selectionStart, selectionEnd);
});

const setCaps = (on: boolean) => {
	caps.hidden = !on || !error.hidden;
};
const onKey = (e: KeyboardEvent) => {
	if (typeof e.getModifierState === "function") setCaps(e.getModifierState("CapsLock"));
};
input.addEventListener("keydown", onKey);
input.addEventListener("keyup", onKey);
input.addEventListener("blur", () => setCaps(false));

function showError(key: Key) {
	errorText.textContent = t(key);
	error.hidden = false;
	caps.hidden = true;
	input.setAttribute("aria-invalid", "true");
}

function clearError() {
	if (error.hidden) return;
	error.hidden = true;
	errorText.textContent = "";
	input.removeAttribute("aria-invalid");
}
input.addEventListener("input", clearError);

let shake: Animation | undefined;
function shakeField() {
	if (reducedMotion.matches) return;
	shake?.cancel();
	shake = field.animate(
		[
			{ transform: "translateX(0)" },
			{ transform: "translateX(-6px)" },
			{ transform: "translateX(5px)" },
			{ transform: "translateX(-3px)" },
			{ transform: "translateX(2px)" },
			{ transform: "translateX(0)" },
		],
		{ duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
	);
}

function setBusy(busy: boolean) {
	submit.disabled = busy;
	submit.toggleAttribute("aria-busy", busy);
	form.toggleAttribute("data-busy", busy);
	submitLabel.textContent = t(busy ? "busy" : "submit");
}

const ERRORS: Record<string, Key> = { wrong_password: "wrong_password", rate_limited: "rate_limited" };

form.addEventListener("submit", async (e) => {
	e.preventDefault();
	if (submit.disabled) return;
	const password = input.value;
	if (!password) {
		showError("empty");
		shakeField();
		input.focus();
		return;
	}
	clearError();
	setBusy(true);
	let res: Response;
	try {
		res = await fetch("/api/login", {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ password }),
			credentials: "same-origin",
		});
	} catch {
		setBusy(false);
		showError("network");
		return;
	}
	if (res.ok) {
		// Return to the deep link that sent us here, but only within this origin (mirrors the Worker's check).
		const next = new URLSearchParams(location.search).get("next");
		const target = next?.startsWith("/") ? new URL(next, location.origin) : null;
		const safe = target && target.origin === location.origin && !target.pathname.startsWith("/login");
		location.replace(safe ? target.pathname + target.search + target.hash : "/");
		return;
	}
	const code = await res
		.json()
		.then((body: { error?: string }) => body.error ?? "")
		.catch(() => "");
	setBusy(false);
	const key = ERRORS[code] ?? (res.status === 429 ? "rate_limited" : res.status >= 500 ? "network" : "unknown");
	showError(key);
	if (key === "wrong_password") {
		shakeField();
		input.select();
	}
	input.focus({ preventScroll: true });
});
