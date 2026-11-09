const vi = {
	title: "Nhạc",
	brand: "Nhạc",
	status: "chờ tín hiệu",
	lede: "Thư viện lossless riêng. Nhập mật khẩu để vào nghe.",
	password: "Mật khẩu",
	show: "Hiện mật khẩu",
	hide: "Ẩn mật khẩu",
	caps: "Caps Lock đang bật",
	submit: "Vào nghe",
	busy: "Đang mở",
	spec: "FLAC · ALAC · WAV · tới 24-bit / 192 kHz",
	empty: "Nhập mật khẩu",
	wrong_password: "Sai mật khẩu",
	rate_limited: "Thử lại sau một phút",
	network: "Không kết nối được máy chủ",
	unknown: "Có lỗi, thử lại",
};

export type Key = keyof typeof vi;

const en: Record<Key, string> = {
	title: "nhac",
	brand: "nhac",
	status: "awaiting signal",
	lede: "Your private lossless library. Enter the password to listen.",
	password: "Password",
	show: "Show password",
	hide: "Hide password",
	caps: "Caps Lock is on",
	submit: "Enter",
	busy: "Opening",
	spec: "FLAC · ALAC · WAV · up to 24-bit / 192 kHz",
	empty: "Enter the password",
	wrong_password: "Wrong password",
	rate_limited: "Try again in a minute",
	network: "Can't reach the server",
	unknown: "Something went wrong, try again",
};

/** Vietnamese when the browser language is Vietnamese, English otherwise. */
export const lang: "vi" | "en" = navigator.language?.toLowerCase().startsWith("vi") ? "vi" : "en";

const dict = lang === "vi" ? vi : en;

export const t = (key: Key): string => dict[key];

/** Fills `[data-i18n]` text and `[data-i18n-label]` aria-labels. The markup ships Vietnamese, so this only runs for English. */
export function localize(root: ParentNode = document): void {
	document.documentElement.lang = lang;
	document.title = t("title");
	if (lang === "vi") return;
	for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) el.textContent = t(el.dataset.i18n as Key);
	for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-label]")) el.setAttribute("aria-label", t(el.dataset.i18nLabel as Key));
}
