import { formatBytes } from "../lib/format";
import { dict, fmtN, langPref, locale, setLangPref, type LangPref } from "../lib/i18n";
import { catalog } from "../lib/library";
import { meterBroken, meterSupport } from "../lib/meter";
import { Icon } from "../components/icons";

async function logout() {
	try {
		await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
	} finally {
		location.replace("/login");
	}
}

export function SettingsView() {
	const t = dict.value;
	const c = catalog();
	const s = c.data.stats;
	const hours = Math.floor(s.seconds / 3600);
	const minutes = Math.floor((s.seconds % 3600) / 60);
	const langs: [LangPref, string][] = [
		["vi", "Tiếng Việt"],
		["en", "English"],
		["auto", t.languageAuto],
	];
	const stats: [string, string][] = [
		[t.statTracks, fmtN(c.tracks.length)],
		[t.statAlbums, fmtN(c.albums.length)],
		[t.statArtists, fmtN(c.artists.length)],
		[t.statHiRes, fmtN(c.hiResTracks)],
		[t.statSize, formatBytes(s.bytes, locale.value)],
		[t.statDuration, t.hours(hours, minutes)],
	];
	const qs = s.quality;
	const analysed = qs ? (qs.lossless ?? 0) + (qs.upsampled ?? 0) + (qs.lossy ?? 0) + (qs.unknown ?? 0) : 0;
	const quality: [string, number, string | undefined][] = qs
		? [
				[t.qLossless, qs.lossless ?? 0, "lossless"],
				[t.qUpsampled, qs.upsampled ?? 0, "upsampled"],
				[t.qLossy, qs.lossy ?? 0, "lossy"],
				[t.qUnknown, qs.unknown ?? 0, undefined],
			]
		: [];
	if (qs && s.tracks > analysed) quality.push([t.qNotAnalysed, s.tracks - analysed, undefined]);
	const kb: [string, string][] = [
		["Space", t.kbPlay],
		["← →", t.kbSeek],
		["Shift ← →", t.kbTrack],
		["M", t.kbMute],
		["/  ⌘K", t.kbSearch],
		["L", t.kbLyrics],
		["S", t.kbSpectrum],
	];

	return (
		<div class="page settings-page">
			<div class="page-head">
				<h1 class="page-title" tabIndex={-1}>
					{t.settingsTitle}
				</h1>
			</div>

			<section class="settings-group">
				<h2 class="section-title">{t.language}</h2>
				<div class="segmented" role="radiogroup" aria-label={t.language}>
					{langs.map(([k, label]) => (
						<button key={k} type="button" role="radio" aria-checked={langPref.value === k} onClick={() => setLangPref(k)}>
							{label}
						</button>
					))}
				</div>
			</section>

			<section class="settings-group">
				<h2 class="section-title">{t.libraryStats}</h2>
				<dl class="stats">
					{stats.map(([k, v]) => (
						<div key={k} class="stat">
							<dt>{k}</dt>
							<dd>{v}</dd>
						</div>
					))}
				</dl>
			</section>

			{qs && (
				<section class="settings-group">
					<h2 class="section-title">{t.qualityTitle}</h2>
					<dl class="stats">
						{quality.map(([k, n, v]) => (
							<div key={k} class="stat">
								<dt>
									{v && <i class="vdot" data-v={v} aria-hidden="true" />}
									{k}
								</dt>
								<dd>{fmtN(n)}</dd>
							</div>
						))}
					</dl>
					<p class="muted settings-note">{t.qualityNote}</p>
				</section>
			)}

			<section class="settings-group">
				<h2 class="section-title">{t.meterTitle}</h2>
				<p class="muted">{meterSupport === "ios" ? t.meterOff : meterSupport === "on" && !meterBroken.value ? t.meterOn : t.meterUnavailable}</p>
			</section>

			<section class="settings-group kb-group">
				<h2 class="section-title">{t.shortcuts}</h2>
				<dl class="kb">
					{kb.map(([k, v]) => (
						<div key={k} class="kb-row">
							<dt>
								<kbd class="mono">{k}</kbd>
							</dt>
							<dd>{v}</dd>
						</div>
					))}
				</dl>
			</section>

			<section class="settings-group">
				<h2 class="section-title">{t.account}</h2>
				<button type="button" class="btn" onClick={logout}>
					<Icon name="signOut" size={18} />
					<span>{t.logout}</span>
				</button>
			</section>

			<section class="settings-group">
				<h2 class="section-title">{t.about}</h2>
				<p class="muted">{t.aboutBody}</p>
			</section>
		</div>
	);
}
