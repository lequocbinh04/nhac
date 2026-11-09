// Menu contents shared by a ⋯ button and the right-click / keyboard context menu of the same item.
import type { AlbumInfo, Catalog } from "../lib/catalog";
import { dict } from "../lib/i18n";
import { catalog } from "../lib/library";
import * as player from "../lib/player";
import { href, navigate } from "../lib/router";
import { shareLink, usesNativeShare } from "../lib/share";
import { toast } from "../lib/toast";
import type { Track } from "../lib/types";
import { contextMenu, type MenuItem } from "./Menu";

export function trackMenuItems(c: Catalog, t: Track): MenuItem[] {
	const d = dict.value;
	const info = c.album.get(t.albumId);
	const items: MenuItem[] = [
		{
			label: d.playNext,
			onSelect: () => {
				player.playNext([t.id]);
				toast(d.addedNext(t.title));
			},
		},
		{
			label: d.addToQueue,
			onSelect: () => {
				player.addToQueue([t.id]);
				toast(d.addedQueue(t.title));
			},
		},
	];
	if (info) items.push({ label: d.goToAlbum, onSelect: () => navigate(href.album(info.album.id)) });
	const first = info?.artists[0];
	if (first) items.push({ label: d.goToArtist, onSelect: () => navigate(href.artist(first.key)) });
	items.push({ label: usesNativeShare() ? d.share : d.copyLink, onSelect: () => void shareLink(href.track(t.id), `${t.title} · ${t.artist}`) });
	return items;
}

export function albumMenuItems(info: AlbumInfo): MenuItem[] {
	const d = dict.value;
	const a = info.album;
	const ids = info.tracks.map((x) => x.id);
	const items: MenuItem[] = [
		{
			label: d.playNext,
			onSelect: () => {
				player.playNext(ids);
				toast(d.addedNext(a.title));
			},
		},
		{
			label: d.addToQueue,
			onSelect: () => {
				player.addToQueue(ids);
				toast(d.addedQueue(a.title));
			},
		},
	];
	const first = info.artists[0];
	if (first) items.push({ label: d.goToArtist, onSelect: () => navigate(href.artist(first.key)) });
	items.push({ label: usesNativeShare() ? d.share : d.copyLink, onSelect: () => void shareLink(href.album(a.id), `${a.title} · ${a.artist}`) });
	return items;
}

/** Context menu for the playing track (player bar, mini player, Now Playing). */
export function currentTrackMenu(focus?: () => HTMLElement | null) {
	return contextMenu(() => {
		const tr = player.current.peek();
		return tr ? { label: tr.title, items: trackMenuItems(catalog(), tr) } : null;
	}, focus);
}
