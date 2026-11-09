// Share a link: the system share sheet on touch devices that have one, else copy to the
// clipboard with a toast; if the clipboard refuses, the toast shows the link to copy by hand.
import { dict } from "./i18n";
import { toast } from "./toast";

const coarse = typeof matchMedia === "undefined" ? null : matchMedia("(pointer: coarse)");

/** The system share sheet on touch devices; desktops (which may also have one) copy instead. */
export function usesNativeShare(): boolean {
	if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
	return !!coarse?.matches || navigator.maxTouchPoints > 0;
}

/** `path` is app-relative (e.g. from links.ts); `title` is "<title> · <artist>". */
export async function shareLink(path: string, title: string): Promise<void> {
	const url = new URL(path, location.origin).href;
	if (usesNativeShare()) {
		try {
			await navigator.share({ title, url });
			return;
		} catch (err) {
			// The user closed the sheet: nothing to do. Anything else: fall back to copying.
			if (err instanceof DOMException && err.name === "AbortError") return;
		}
	}
	try {
		await navigator.clipboard.writeText(url);
		toast(dict.value.linkCopied);
	} catch {
		toast(dict.value.copyFailed, { detail: url });
	}
}
