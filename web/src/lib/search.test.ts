import { describe, expect, it } from "vitest";
import { fold, foldWithMap, highlightParts, makeEntry, matchPhrase, parseQuery, searchEntries } from "./search";

function hitText(raw: string, query: string): string[] {
	const m = matchPhrase(foldWithMap(raw), parseQuery(query));
	return m ? m.spans.map(([s, e]) => raw.slice(s, e)) : [];
}

describe("fold", () => {
	it("strips Vietnamese tones and folds đ", () => {
		expect(fold("Đông Hà K-Lo")).toBe("dong ha k-lo");
		expect(fold("Đèn Vàng")).toBe("den vang");
		expect(fold("Xuân, Hạ, Thu, Đông")).toBe("xuan, ha, thu, dong");
		expect(fold("ĐÊM SÀI GÒN")).toBe("dem sai gon");
	});

	it("treats precomposed and decomposed input the same", () => {
		expect(fold("Tu\u0300ng")).toBe(fold("Tùng"));
	});
});

describe("highlight spans map back to the original text", () => {
	it("covers the accented characters the user sees", () => {
		expect(hitText("Đông Hà K-Lo", "dong ha")).toEqual(["Đông Hà"]);
		expect(hitText("MÙA HẠ TRONG VEO (Đông Hà K-Lo, Tiệm Mưa)", "dong ha")).toEqual(["Đông Hà"]);
		expect(hitText("Đèn Vàng", "đèn")).toEqual(["Đèn"]);
	});

	it("includes trailing combining marks of decomposed (NFD) strings", () => {
		const nfd = "Đo\u0302ng Ha\u0300";
		expect(hitText(nfd, "dong ha")).toEqual([nfd]);
	});

	it("prefers a match at a word start", () => {
		const raw = "lune ferrolune";
		const m = matchPhrase(foldWithMap(raw), parseQuery("lune"));
		expect(m?.spans).toEqual([[0, 4]]);
		const m2 = matchPhrase(foldWithMap("Ferrolune · Lune"), parseQuery("lune"));
		expect(m2?.spans).toEqual([[12, 16]]);
	});

	it("splits text into marked parts and merges overlaps", () => {
		expect(highlightParts("Đông Hà K-Lo", [[0, 7]])).toEqual([
			{ text: "Đông Hà", hit: true },
			{ text: " K-Lo", hit: false },
		]);
		expect(highlightParts("abcdef", [[3, 5], [1, 4]])).toEqual([
			{ text: "a", hit: false },
			{ text: "bcde", hit: true },
			{ text: "f", hit: false },
		]);
		expect(highlightParts("abc", [])).toEqual([{ text: "abc", hit: false }]);
	});
});

describe("ranking", () => {
	const entries = [
		makeEntry("track:Ferrolune (intro)", ["Ferrolune (intro)", "Lune", "Ferrolune Days"]),
		makeEntry("album:Mộng Hà", ["MỘNG HÀ - EP", "Lune"]),
		makeEntry("artist:Lune", ["Lune"]),
		makeEntry("track:Lunesta", ["Lunesta", "Someone", "X"]),
	];
	it("ranks exact > prefix > weaker matches, ties keep library order", () => {
		const { hits } = searchEntries(entries, parseQuery("lune"));
		expect(hits.map((h) => h.item)).toEqual(["artist:Lune", "track:Lunesta", "track:Ferrolune (intro)", "album:Mộng Hà"]);
	});

	it("matches tokens spread across fields", () => {
		const { hits } = searchEntries([makeEntry("x", ["Mùa Hạ Trong Veo", "Đông Hà K-Lo"]), makeEntry("y", ["Mùa Hạ Trong Veo", "Tiệm Mưa"])], parseQuery("veo dong"));
		expect(hits.map((h) => h.item)).toEqual(["x"]);
		expect(hits[0].spans[0]).toEqual([[13, 16]]);
	});

	it("finds 'dong ha' in artist names written with or without diacritics", () => {
		const { hits, total } = searchEntries(
			[makeEntry("a", ["Đông Hà K-Lo"]), makeEntry("b", ["Dong Ha K-Lo"]), makeEntry("c", ["Đinh Hà Lộ"])],
			parseQuery("dong ha"),
		);
		expect(total).toBe(2);
		expect(hits.map((h) => h.item).sort()).toEqual(["a", "b"]);
	});

	it("returns nothing for an empty query and respects the limit", () => {
		expect(searchEntries(entries, parseQuery("   ")).total).toBe(0);
		const r = searchEntries(entries, parseQuery("lune"), 2);
		expect(r.hits).toHaveLength(2);
		expect(r.total).toBe(4);
	});

	it("applies the kind bias only to break ties", () => {
		const { hits } = searchEntries([makeEntry("track", ["Quán Khuya"], 1), makeEntry("album", ["Quán Khuya"], 2)], parseQuery("quan khuya"));
		expect(hits.map((h) => h.item)).toEqual(["album", "track"]);
	});
});
