import { describe, expect, it } from "vitest";
import { artistKey, artistSegments, buildCatalog, splitArtists } from "./catalog";
import type { LibraryData, Track } from "./types";

describe("splitArtists", () => {
	it("splits on ; , & and feat.", () => {
		expect(splitArtists("Lặng Collective; Hạ Vy Ensemble; Gió Lộng Trio")).toEqual(["Lặng Collective", "Hạ Vy Ensemble", "Gió Lộng Trio"]);
		expect(splitArtists("Đông Hà K-Lo, Tiệm Mưa")).toEqual(["Đông Hà K-Lo", "Tiệm Mưa"]);
		expect(splitArtists("Ferro & Lune")).toEqual(["Ferro", "Lune"]);
		expect(splitArtists("Vân Lam feat. Kite Harbor")).toEqual(["Vân Lam", "Kite Harbor"]);
		expect(splitArtists("Đèn ft. NOX")).toEqual(["Đèn", "NOX"]);
		expect(splitArtists("17 Vesper/ Bờ Nghiêng/ lanthuyen")).toEqual(["17 Vesper", "Bờ Nghiêng", "lanthuyen"]);
		expect(splitArtists("AC/DC")).toEqual(["AC/DC"]);
	});

	it("segments keep the original credit text exactly, with keys only on names", () => {
		const credits = ["Ferro & Lune", "Lặng Collective; Hạ Vy Ensemble", "17 Vesper/ Bờ Nghiêng", "Vân Lam feat. Kite Harbor", "Đông Hà K-Lo, Tiệm Mưa", "AC/DC", "A;B", ""];
		for (const s of credits) expect(artistSegments(s).map((x) => x.text).join("")).toBe(s);
		expect(artistSegments("Ferro & Lune")).toEqual([
			{ text: "Ferro", key: "ferro" },
			{ text: " & ", key: null },
			{ text: "Lune", key: "lune" },
		]);
		expect(artistSegments("Vân Lam feat. Kite Harbor").map((x) => x.key)).toEqual(["vanlam", null, "kiteharbor"]);
		expect(artistSegments("AC/DC")).toEqual([{ text: "AC/DC", key: "acdc" }]);
	});

	it("keeps names that only look like separators and drops duplicates", () => {
		expect(splitArtists("K-LO,K-LO")).toEqual(["K-LO,K-LO"]);
		expect(splitArtists("Vân Lam; vân lam")).toEqual(["Vân Lam"]);
		expect(splitArtists("")).toEqual([]);
	});

	it("keys artists independent of tones, case and punctuation", () => {
		expect(artistKey("Đông Hà K-Lo")).toBe(artistKey("Dong Ha Klo"));
		expect(artistKey("(N)ORTH")).toBe("north");
		expect(artistKey("Đèn")).not.toBe(artistKey("Dense"));
	});
});

function track(id: string, albumId: string, artist: string, n: number, extra: Partial<Track> = {}): Track {
	return { id, file: `${id}.flac`, title: id, artist, n, disc: 1, year: "", genre: "", dur: 100, size: 1, codec: "flac", sr: 44100, bits: 16, albumId, ...extra };
}

describe("buildCatalog", () => {
	const data: LibraryData = {
		version: "v",
		stats: { tracks: 4, albums: 2, bytes: 4, seconds: 400 },
		albums: [
			{ id: "a1", title: "Đêm Sài Gòn", artist: "Dong Ha K-Lo", year: "2017", genre: "", trackIds: ["t2", "t1"], cover: true },
			{ id: "a2", title: "Mùa Hạ Trong Veo", artist: "Đông Hà K-Lo", year: "2018", genre: "", trackIds: ["t3", "t4"], cover: false },
		],
		tracks: [
			track("t1", "a1", "Đông Hà K-Lo", 1),
			track("t2", "a1", "Đông Hà K-Lo", 2),
			track("t3", "a2", "Đông Hà K-Lo, Tiệm Mưa", 1, { bits: 24, sr: 48000 }),
			track("t4", "a2", "Đông Hà K-Lo", 2),
		],
	};
	const c = buildCatalog(data);

	it("merges spelling variants into one artist", () => {
		const dh = c.artist.get(artistKey("Đông Hà K-Lo"));
		expect(dh?.name).toBe("Đông Hà K-Lo");
		expect(dh?.albumIds).toEqual(["a1", "a2"]);
		expect(dh?.trackIds).toEqual(["t1", "t2", "t3", "t4"]);
		expect(dh?.coverAlbumId).toBe("a1");
		expect(c.artist.get("tiemmua")?.trackIds).toEqual(["t3"]);
	});

	it("orders album tracks by disc and number and summarizes the spec", () => {
		const a1 = c.album.get("a1");
		expect(a1?.tracks.map((t) => t.id)).toEqual(["t1", "t2"]);
		expect(a1?.cd).toBe(true);
		expect(c.album.get("a2")).toMatchObject({ spec: "16–24/44.1–48", hiRes: true });
		expect(c.hiResTracks).toBe(1);
	});

	it("prefers the spelling with diacritics even when the ASCII tag is more common", () => {
		const c2 = buildCatalog({
			...data,
			albums: [{ ...data.albums[0], artist: "Dong Ha K-Lo", trackIds: ["x1", "x2", "x3"] }],
			tracks: [track("x1", "a1", "Dong Ha K-Lo", 1), track("x2", "a1", "Dong Ha K-Lo", 2), track("x3", "a1", "Đông Hà K-Lo", 3)],
		});
		expect(c2.artist.get(artistKey("Dong Ha K-Lo"))?.name).toBe("Đông Hà K-Lo");
	});
});
