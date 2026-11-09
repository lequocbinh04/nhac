// In-memory indexes over library.json: albums, tracks, derived artists, specs and search entries.
// Pure: built once after the library loads, never mutated.
import { summarize, type SpecSummary } from "./format";
import { fold, makeEntry, type Entry } from "./search";
import type { Album, LibraryData, Track } from "./types";

export interface Artist {
	key: string;
	name: string;
	/** Albums whose album artist includes this artist */
	albumIds: string[];
	/** Every track this artist is credited on, in library order */
	trackIds: string[];
	/** Album used for the artist's picture */
	coverAlbumId: string | null;
}

export interface AlbumInfo extends SpecSummary {
	album: Album;
	tracks: Track[];
	/** Artists parsed from the album artist string, in order */
	artists: Artist[];
}

export type ArtistItem = { kind: "artist"; artist: Artist };
export type AlbumItem = { kind: "album"; album: Album };
export type TrackItem = { kind: "track"; track: Track };
export type SearchItem = ArtistItem | AlbumItem | TrackItem;

export interface Catalog {
	data: LibraryData;
	albums: Album[];
	tracks: Track[];
	album: Map<string, AlbumInfo>;
	track: Map<string, Track>;
	artists: Artist[];
	artist: Map<string, Artist>;
	hiResTracks: number;
	search: { artists: Entry<ArtistItem>[]; albums: Entry<AlbumItem>[]; tracks: Entry<TrackItem>[] };
}

// ";" always separates; ",", "&" and "/" only next to whitespace, so "AC/DC" stays whole.
const SPLIT = /\s*;\s*|,\s+|\s+&\s+|\s*\/\s+|\s+(?:feat\.?|ft\.|featuring)\s+/i;

/** "A; B", "A, B", "A & B", "A/ B", "A feat. B" -> ["A", "B"] (deduplicated by artist key). */
export function splitArtists(s: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of s.split(SPLIT)) {
		const name = part.trim();
		const key = artistKey(name);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(name);
	}
	return out;
}

export interface ArtistSegment {
	/** Exact slice of the original string */
	text: string;
	/** Artist key for name segments, null for separators and empty names */
	key: string | null;
}

const SPLIT_KEEP = new RegExp(`(${SPLIT.source})`, SPLIT.flags);

/**
 * The original credit string cut into name and separator segments; joining every `text` gives
 * back the input exactly ("Ferro & Lune" stays "Ferro & Lune"), while names carry the key to link.
 */
export function artistSegments(s: string): ArtistSegment[] {
	// split() with one capture group alternates: name, separator, name, separator, name.
	return s
		.split(SPLIT_KEEP)
		.map((text, i) => ({ text, key: i % 2 === 1 ? null : artistKey(text) || null }))
		.filter((seg) => seg.text !== "");
}

/** Spelling-insensitive identity: "Đông Hà K-Lo", "Dong Ha K-Lo" and "Đông Hà Klo" are one artist. */
export function artistKey(name: string): string {
	return fold(name).replace(/[^\p{L}\p{N}]+/gu, "");
}

const collator = new Intl.Collator("vi", { sensitivity: "base", numeric: true });
export const compareText = collator.compare;

function nonAscii(s: string): number {
	let n = 0;
	for (const ch of s) if (ch.charCodeAt(0) > 127) n++;
	return n;
}

export function buildCatalog(data: LibraryData): Catalog {
	const track = new Map<string, Track>();
	for (const t of data.tracks) track.set(t.id, t);

	interface Draft {
		key: string;
		names: Map<string, number>;
		albumIds: string[];
		trackIds: Set<string>;
		coverAlbumId: string | null;
	}
	const drafts = new Map<string, Draft>();
	const credit = (name: string): Draft => {
		const key = artistKey(name);
		let d = drafts.get(key);
		if (!d) {
			d = { key, names: new Map(), albumIds: [], trackIds: new Set(), coverAlbumId: null };
			drafts.set(key, d);
		}
		d.names.set(name, (d.names.get(name) ?? 0) + 1);
		return d;
	};

	const albumArtistKeys = new Map<string, string[]>();
	const album = new Map<string, AlbumInfo>();
	for (const a of data.albums) {
		const tracks = a.trackIds
			.map((id) => track.get(id))
			.filter((t): t is Track => !!t)
			.sort((x, y) => (x.disc || 1) - (y.disc || 1) || (x.n || 0) - (y.n || 0));
		const keys: string[] = [];
		for (const name of splitArtists(a.artist)) {
			const d = credit(name);
			d.albumIds.push(a.id);
			if (!d.coverAlbumId && a.cover) d.coverAlbumId = a.id;
			keys.push(d.key);
		}
		albumArtistKeys.set(a.id, keys);
		album.set(a.id, { ...summarize(tracks), album: a, tracks, artists: [] });
	}
	let hiResTracks = 0;
	for (const t of data.tracks) {
		if (t.bits >= 24) hiResTracks++;
		for (const name of splitArtists(t.artist)) {
			const d = credit(name);
			d.trackIds.add(t.id);
			if (!d.coverAlbumId && album.get(t.albumId)?.album.cover) d.coverAlbumId = t.albumId;
		}
	}

	const artist = new Map<string, Artist>();
	for (const d of drafts.values()) {
		// Display a spelling with Vietnamese diacritics when one exists ("Đông Hà K-Lo" over an
		// ASCII-only tag), then the most used one.
		let name = "";
		let best = -1;
		for (const [n, count] of d.names) {
			const score = (nonAscii(n) > 0 ? 1e6 : 0) + count * 100 + Math.min(99, nonAscii(n));
			if (score > best) {
				best = score;
				name = n;
			}
		}
		artist.set(d.key, { key: d.key, name, albumIds: d.albumIds, trackIds: [...d.trackIds], coverAlbumId: d.coverAlbumId });
	}
	for (const [id, keys] of albumArtistKeys) {
		const info = album.get(id);
		if (info) info.artists = keys.map((k) => artist.get(k)).filter((x): x is Artist => !!x);
	}

	const artists = [...artist.values()].sort((a, b) => compareText(a.name, b.name));
	const albums = data.albums.filter((a) => (album.get(a.id)?.tracks.length ?? 0) > 0);

	return {
		data,
		albums,
		tracks: data.tracks,
		album,
		track,
		artists,
		artist,
		hiResTracks,
		search: {
			artists: artists.map((a) => makeEntry<ArtistItem>({ kind: "artist", artist: a }, [a.name], 3)),
			albums: albums.map((a) => makeEntry<AlbumItem>({ kind: "album", album: a }, [a.title, a.artist], 2)),
			tracks: data.tracks.map((t) =>
				makeEntry<TrackItem>({ kind: "track", track: t }, [t.title, t.artist, album.get(t.albumId)?.album.title ?? ""], 1),
			),
		},
	};
}
