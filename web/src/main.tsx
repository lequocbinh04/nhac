// Entry: fonts, styles, router, shortcuts, library, player.
import "@fontsource-variable/inter/wght.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-ext-400.css";
import "@fontsource/jetbrains-mono/vietnamese-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/vietnamese-500.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/views.css";
import "./styles/nowplaying.css";
import "./styles/lyrics.css";

import { effect } from "@preact/signals";
import { render } from "preact";
import { App } from "./app";
import { dict, lang } from "./lib/i18n";
import { installShortcuts } from "./lib/keyboard";
import { loadLibrary } from "./lib/library";
import { startLyrics } from "./lib/lyricsStore";
import * as player from "./lib/player";
import { nav, startRouter } from "./lib/router";
import { searchText } from "./lib/ui";

startRouter();
installShortcuts();
startLyrics();

effect(() => {
	document.documentElement.lang = lang.value;
});

// Window title follows the current track.
effect(() => {
	const tr = player.current.value;
	document.title = tr ? `${tr.title} · ${tr.artist}` : dict.value.appName;
});

// Keep the search text in step with the URL on load and back/forward; clear it on leaving search.
effect(() => {
	const n = nav.value;
	if (n.route.name === "search") {
		if (n.kind === "initial" || n.kind === "pop") searchText.value = n.route.q;
	} else if (n.kind === "push" || n.kind === "pop") {
		searchText.value = "";
	}
});

render(<App />, document.getElementById("app")!);

void loadLibrary().then((c) => {
	if (!c) return;
	player.initPlayer({
		track: (id) => c.track.get(id),
		album: (id) => c.album.get(id)?.album,
	});
});
