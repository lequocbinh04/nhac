// Global shortcuts. Nothing here animates: keyboard actions must feel instant.
import * as player from "./player";
import { href, nav, navigate } from "./router";
import { focusSearch, isMobile, nowPlayingOpen, togglePane } from "./ui";

function typing(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
	if (target instanceof HTMLInputElement) return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(target.type);
	return false;
}

/** Controls that own the arrow keys or Space themselves. */
function ownsKeys(target: EventTarget | null, key: string): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.getAttribute("role") === "slider" || (target instanceof HTMLInputElement && target.type === "range")) return key !== " ";
	if (key === " " && (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement || target.getAttribute("role") === "button")) return true;
	return !!target.closest("[role=menu]");
}

function openSearch() {
	if (isMobile.value && nav.value.route.name !== "search") navigate(href.search(""), { keyboard: true });
	nowPlayingOpen.value = false;
	requestAnimationFrame(focusSearch);
}

export function installShortcuts() {
	document.addEventListener("keydown", (e) => {
		if (e.defaultPrevented || e.isComposing) return;
		if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
			e.preventDefault();
			openSearch();
			return;
		}
		if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || ownsKeys(e.target, e.key)) return;
		switch (e.key) {
			case " ":
				e.preventDefault();
				player.toggle();
				break;
			case "ArrowLeft":
				e.preventDefault();
				if (e.shiftKey) player.prev();
				else player.seekBy(-10);
				break;
			case "ArrowRight":
				e.preventDefault();
				if (e.shiftKey) player.next();
				else player.seekBy(10);
				break;
			case "m":
			case "M":
				player.toggleMute();
				break;
			case "l":
			case "L":
				if (nowPlayingOpen.value && player.current.value?.lyrics) togglePane("lyrics");
				break;
			case "s":
			case "S":
				if (nowPlayingOpen.value && player.current.value?.spectrum) togglePane("spectrum");
				break;
			case "/":
				e.preventDefault();
				openSearch();
				break;
		}
	});
}
