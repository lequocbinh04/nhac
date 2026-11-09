#!/usr/bin/env python3
"""Index a local music folder for nhac.

Reads tags and stream info with ffprobe, groups tracks into albums and extracts embedded cover art.
Writes <out>/library.json and <out>/covers/<albumId>.jpg. Upload <out> to <bucket>/<LIBRARY_PREFIX>
and the music folder itself to the bucket root, keeping the same relative paths.

Each track also gets `peaks`: a 96-bin loudness envelope for the waveform seek bar, base64 of 96 bytes
(0..255). The audio is decoded once with ffmpeg to 4 kHz mono 16-bit PCM; each bin holds the mean
absolute amplitude of its slice of the track, divided by the loudest bin of that track, then shaped with
a square root (out = 255 * sqrt(bin / loudest)). The mean rather than the per-bin peak is deliberate:
modern masters hit ~0 dBFS in almost every 2-3 s window, so raw peaks draw a flat bar. Per-track
normalisation plus the square root keeps intros, breaks and quiet recordings visibly shaped. Results are
cached in <out>/peaks-cache.json keyed by file, size and mtime, so re-runs only decode changed files
(the Worker never reads that cache; uploading it is harmless but unnecessary). Files ffmpeg cannot
decode get no `peaks` field.

Lyrics: embedded tags (any key containing "lyric", e.g. LYRICS, UNSYNCEDLYRICS, or MP4 ©lyr; not
LYRICIST) and a sidecar <same basename>.lrc next to the audio file. Text counts as "synced" when at least
two lines start with [mm:ss] / [mm:ss.xx] timestamps, otherwise "plain". Synced beats plain; on a tie the
sidecar wins, because it is the copy a user edits. The chosen text (BOM stripped, LF line endings,
otherwise as found) goes to <out>/lyrics/<trackId>.lrc and the track gets "lyrics": "synced" | "plain".
Files are rewritten only when their content changes, and stale ones are removed.

Spectrogram and authenticity (tools/quality.py has the details and limits): each decodable track gets a
1200x400 spectrogram at <out>/spectra/<trackId>.webp (.png when ffmpeg lacks libwebp), "spectrum": true,
and "quality": {"verdict": "lossless" | "upsampled" | "lossy" | "unknown", "cutoffHz", "effectiveBits"?,
"source"?, "confidence"}; stats.quality counts the verdicts. A lossy verdict means the file shows a lossy
encoder's low-pass or MP3's flickering top band; upsampled means a hi-res file with no content above the
44.1/48k band or a 24-bit file whose samples use only 16 bits. Results are cached in
<out>/quality-cache.json under the same file, size and mtime key as the waveforms.

Requires ffmpeg and ffprobe on PATH. Python 3.9+, standard library only.
"""
import argparse, array, base64, collections, hashlib, json, math, os, re, subprocess, sys, unicodedata
from concurrent.futures import ThreadPoolExecutor

import quality

AUDIO_EXTENSIONS = (".flac", ".m4a", ".mp3", ".wav", ".aiff", ".aif", ".ogg", ".opus")
PEAK_BINS = 96
PEAKS_CACHE_VERSION = 1
QUALITY_CACHE_VERSION = 1
LRC_LINE = re.compile(r"^(?:\[\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?\])+")
LRC_TAG = re.compile(r"\[[^\]]*\]|<\d{1,3}:\d\d(?:[.:]\d{1,3})?>")
# Whole-text placeholders some taggers write instead of lyrics; matched against fold() of the only line.
PLACEHOLDER = re.compile(
    r"(no lyrics?( (are |is )?(available|found|yet))?"
    r"|lyrics? (not (available|found)|unavailable|coming soon)"
    r"|(this (song|track) is )?(an )?instrumental( (track|music|version|song))?"
    r"|(khong|chua) co loi( bai hat)?|nhac khong loi|bai hat khong co loi"
    r"|纯音乐(, ?请欣赏)?)")


def fold(s):
    """Case- and diacritic-insensitive key (also folds Vietnamese đ)."""
    s = unicodedata.normalize("NFD", s or "").replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower().strip()


def short_id(*parts):
    return hashlib.sha1("\x1f".join(parts).encode()).hexdigest()[:12]


def number(value):
    try:
        return int(str(value or "0").split("/")[0])
    except ValueError:
        return 0


def normalize_lyrics(text):
    """BOM stripped, LF line endings, surrounding blank lines dropped; None when there is no text or the
    only line left after removing LRC timestamps and [ar:]/[ti:] style tags is a placeholder such as
    "No lyrics available", "Instrumental" or "Không có lời"."""
    text = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    lines = [s for s in (LRC_TAG.sub("", line).strip() for line in text.split("\n")) if s]
    if not lines:
        return None
    if len(lines) == 1 and PLACEHOLDER.fullmatch(re.sub(r"[\s.!…\-–—_*()]+", " ", fold(lines[0])).strip().replace("，", ",")):
        return None
    return text + "\n"


def lyrics_kind(text):
    return "synced" if sum(1 for line in text.split("\n") if LRC_LINE.match(line.strip())) >= 2 else "plain"


def read_sidecar(path):
    for ext in (".lrc", ".LRC"):
        try:
            with open(path + ext, "rb") as f:
                raw = f.read()
        except OSError:
            continue
        if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
            return raw.decode("utf-16", errors="replace")
        try:
            return raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            return raw.decode("cp1252", errors="replace")
    return None


def pick_lyrics(embedded, sidecar):
    """(text, kind) or (None, None). Order candidates sidecar-first so it wins ties; synced beats plain."""
    candidates = [t for t in (normalize_lyrics(x) for x in [sidecar or "", *embedded]) if t]
    if not candidates:
        return None, None
    text = next((t for t in candidates if lyrics_kind(t) == "synced"), candidates[0])
    return text, lyrics_kind(text)


def probe(root, key):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration,size:format_tags:stream=codec_type,codec_name,sample_rate,bits_per_raw_sample,bits_per_sample:stream_tags",
         "-of", "json", os.path.join(root, key)],
        capture_output=True, text=True).stdout
    try:
        info = json.loads(out or "{}")
    except json.JSONDecodeError:
        return None
    tags, lyrics, audio, has_cover = {}, [], None, False
    for source in [*(s.get("tags") or {} for s in info.get("streams", [])), info.get("format", {}).get("tags") or {}]:
        for k, v in source.items():
            k = k.lower()
            tags[k] = v
            if ("lyric" in k or k.endswith("lyr")) and "lyricist" not in k and isinstance(v, str):
                lyrics.append(v)
    for stream in info.get("streams", []):
        if stream.get("codec_type") == "audio" and audio is None:
            audio = stream
        elif stream.get("codec_type") == "video":
            has_cover = True
    if audio is None:
        return None
    bits = str(audio.get("bits_per_raw_sample") or audio.get("bits_per_sample") or "0")
    stem = os.path.splitext(os.path.basename(key))[0]
    artist = (tags.get("artist") or "").strip()
    return {
        "id": short_id(key),
        "file": key,
        "title": (tags.get("title") or stem).strip(),
        "artist": artist,
        "albumTitle": (tags.get("album") or f"{stem} - Single").strip(),
        "albumArtist": (tags.get("album_artist") or tags.get("albumartist") or artist or "Unknown artist").strip(),
        "n": number(tags.get("track")),
        "disc": number(tags.get("disc")),
        "year": (tags.get("date") or tags.get("year") or "")[:4],
        "genre": (tags.get("genre") or "").strip(),
        "dur": round(float(info.get("format", {}).get("duration") or 0), 2),
        "size": int(info.get("format", {}).get("size") or 0),
        "codec": audio.get("codec_name", ""),
        "sr": int(audio.get("sample_rate") or 0),
        "bits": int(bits) if bits.isdigit() else 0,
        "_cover": has_cover,
        "_lyrics": pick_lyrics(lyrics, read_sidecar(os.path.splitext(os.path.join(root, key))[0])),
    }


def extract_cover(root, key, dst):
    if os.path.exists(dst):
        return True
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", os.path.join(root, key), "-map", "0:v:0", "-frames:v", "1",
         "-vf", "scale='min(512,iw)':-2", "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", dst],
        capture_output=True)
    return result.returncode == 0 and os.path.exists(dst)


def compute_peaks(path):
    """96-byte loudness envelope of one file as base64, or None when it cannot be decoded."""
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", "4000", "-f", "s16le", "-"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    samples, tail = array.array("h"), b""
    for chunk in iter(lambda: proc.stdout.read(1 << 16), b""):
        chunk = tail + chunk
        cut = len(chunk) & ~1
        samples.frombytes(chunk[:cut])
        tail = chunk[cut:]
    if proc.wait() != 0 or len(samples) < PEAK_BINS:
        return None
    if sys.byteorder == "big":
        samples.byteswap()
    n = len(samples)
    edges = [i * n // PEAK_BINS for i in range(PEAK_BINS + 1)]
    # sum(map(abs, ...)) runs in C, so a 5-minute track bins in ~10 ms.
    env = [sum(map(abs, samples[a:b])) / (b - a) for a, b in zip(edges, edges[1:])]
    loudest = max(env)
    if loudest <= 0:
        return base64.b64encode(bytes(PEAK_BINS)).decode()
    return base64.b64encode(bytes(round(255 * math.sqrt(e / loudest)) for e in env)).decode()


def peaks_cache_key(root, key):
    st = os.stat(os.path.join(root, key))
    return f"{key}\x1f{st.st_size}\x1f{st.st_mtime_ns}"


def load_peaks_cache(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data.get("entries", {}) if data.get("version") == PEAKS_CACHE_VERSION else {}


def load_quality_cache(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data.get("entries", {}) if data.get("version") == QUALITY_CACHE_VERSION else {}


def analyse_quality(root, track, spectra_dir):
    """{"quality": ..., "spectrum": "webp" | "png" | None}; writes <spectra_dir>/<id>.<ext>."""
    verdict, picture, ext = quality.analyse(os.path.join(root, track["file"]), sr=track["sr"], bits=track["bits"],
                                            codec=track["codec"], dur=track["dur"])
    for old in ("webp", "png"):
        if old != ext and os.path.exists(os.path.join(spectra_dir, f"{track['id']}.{old}")):
            os.remove(os.path.join(spectra_dir, f"{track['id']}.{old}"))
    if picture is not None:
        with open(os.path.join(spectra_dir, f"{track['id']}.{ext}"), "wb") as f:
            f.write(picture)
    return {"quality": verdict, "spectrum": ext}


def index_file(root, key, caches, fresh, spectra_dir):
    track = probe(root, key)
    if track is None:
        return None
    cache_key = peaks_cache_key(root, key)
    if cache_key in caches["peaks"]:
        peaks = caches["peaks"][cache_key]
    else:
        peaks = compute_peaks(os.path.join(root, key))
        if peaks is not None:
            fresh["peaks"][cache_key] = peaks
    analysis = caches["quality"].get(cache_key)
    if analysis is None or (analysis["spectrum"] and
                            not os.path.exists(os.path.join(spectra_dir, f"{track['id']}.{analysis['spectrum']}"))):
        analysis = analyse_quality(root, track, spectra_dir)
        fresh["quality"][cache_key] = analysis
    track["_peaks"] = peaks
    track["_analysis"] = analysis
    track["_cacheKey"] = cache_key
    return track


def write_lyrics(lyrics_dir, tracks):
    """Sync <out>/lyrics with the tracks' chosen lyrics; returns (written, removed) file counts."""
    os.makedirs(lyrics_dir, exist_ok=True)
    wanted = {f"{t['id']}.lrc": t["_lyrics"][0] for t in tracks if t["_lyrics"][0]}
    written = removed = 0
    for name, text in wanted.items():
        path, data = os.path.join(lyrics_dir, name), text.encode("utf-8")
        try:
            with open(path, "rb") as f:
                if f.read() == data:
                    continue
        except OSError:
            pass
        with open(path, "wb") as f:
            f.write(data)
        written += 1
    for name in os.listdir(lyrics_dir):
        if name.endswith(".lrc") and name not in wanted:
            os.remove(os.path.join(lyrics_dir, name))
            removed += 1
    return written, removed


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("music_dir", help="local folder that mirrors the bucket's music files")
    parser.add_argument("--out", default="library-data", help="output folder (default: library-data)")
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    args = parser.parse_args()

    root = os.path.abspath(args.music_dir)
    covers_dir = os.path.join(args.out, "covers")
    spectra_dir = os.path.join(args.out, "spectra")
    os.makedirs(covers_dir, exist_ok=True)
    os.makedirs(spectra_dir, exist_ok=True)

    keys = sorted(
        os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/")
        for d, _, files in os.walk(root) for f in files
        if f.lower().endswith(AUDIO_EXTENSIONS) and not f.startswith("."))
    peaks_cache_path = os.path.join(args.out, "peaks-cache.json")
    quality_cache_path = os.path.join(args.out, "quality-cache.json")
    caches = {"peaks": load_peaks_cache(peaks_cache_path), "quality": load_quality_cache(quality_cache_path)}
    fresh = {"peaks": {}, "quality": {}}
    with ThreadPoolExecutor(args.jobs) as pool:
        tracks = [t for t in pool.map(lambda k: index_file(root, k, caches, fresh, spectra_dir), keys) if t]
    if not tracks:
        sys.exit(f"no audio files found under {root}")
    # Keep only entries for files that still exist, so the caches never grow without bound.
    kept = {t["_cacheKey"]: t["_peaks"] for t in tracks if t["_peaks"] is not None}
    with open(peaks_cache_path, "w", encoding="utf-8") as f:
        json.dump({"version": PEAKS_CACHE_VERSION, "entries": kept}, f, ensure_ascii=False, separators=(",", ":"))
    kept = {t["_cacheKey"]: t["_analysis"] for t in tracks}
    with open(quality_cache_path, "w", encoding="utf-8") as f:
        json.dump({"version": QUALITY_CACHE_VERSION, "entries": kept}, f, ensure_ascii=False, separators=(",", ":"))
    wanted = {f"{t['id']}.{t['_analysis']['spectrum']}" for t in tracks if t["_analysis"]["spectrum"]}
    for name in os.listdir(spectra_dir):
        if name not in wanted:
            os.remove(os.path.join(spectra_dir, name))

    groups = collections.defaultdict(list)
    for t in tracks:
        groups[(fold(t["albumTitle"]), fold(t["albumArtist"]))].append(t)

    albums, cover_jobs = [], []
    for group_key, group in groups.items():
        group.sort(key=lambda t: (t["disc"], t["n"], fold(t["title"])))
        album_id = short_id(*group_key)
        source = next((t for t in group if t["_cover"]), None)
        if source:
            cover_jobs.append((album_id, source["file"]))
        albums.append({
            "id": album_id,
            "title": group[0]["albumTitle"],
            "artist": group[0]["albumArtist"],
            "year": max((t["year"] for t in group), default=""),
            "genre": next((t["genre"] for t in group if t["genre"]), ""),
            "trackIds": [t["id"] for t in group],
            "cover": False,
        })
        for t in group:
            t["albumId"] = album_id

    with ThreadPoolExecutor(args.jobs) as pool:
        results = pool.map(lambda job: extract_cover(root, job[1], os.path.join(covers_dir, f"{job[0]}.jpg")), cover_jobs)
        with_cover = {album_id for (album_id, _), ok in zip(cover_jobs, results) if ok}
    for album in albums:
        album["cover"] = album["id"] in with_cover
    lyrics_written, lyrics_removed = write_lyrics(os.path.join(args.out, "lyrics"), tracks)
    for t in tracks:
        peaks, lyrics, analysis = t["_peaks"], t["_lyrics"][1], t["_analysis"]
        for k in ("_cover", "albumTitle", "albumArtist", "_peaks", "_cacheKey", "_lyrics", "_analysis"):
            del t[k]
        if peaks is not None:
            t["peaks"] = peaks
        if lyrics:
            t["lyrics"] = lyrics
        if analysis["spectrum"]:
            t["spectrum"] = True
        t["quality"] = analysis["quality"]
    with_lyrics = sum(1 for t in tracks if "lyrics" in t)
    synced = sum(1 for t in tracks if t.get("lyrics") == "synced")
    verdicts = collections.Counter(t["quality"]["verdict"] for t in tracks)

    albums.sort(key=lambda a: (fold(a["artist"]), fold(a["title"])))
    library = {
        "version": hashlib.sha1("\n".join(t["file"] for t in tracks).encode()).hexdigest()[:10],
        "stats": {"tracks": len(tracks), "albums": len(albums), "bytes": sum(t["size"] for t in tracks),
                  "seconds": round(sum(t["dur"] for t in tracks)), "lyrics": with_lyrics,
                  "quality": {v: verdicts[v] for v in quality.VERDICTS}},
        "albums": albums,
        "tracks": tracks,
    }
    with open(os.path.join(args.out, "library.json"), "w", encoding="utf-8") as f:
        json.dump(library, f, ensure_ascii=False, separators=(",", ":"))
    with_peaks = sum(1 for t in tracks if "peaks" in t)
    with_spectrum = sum(1 for t in tracks if t.get("spectrum"))
    print(f"{len(tracks)} tracks, {len(albums)} albums, {len(with_cover)} covers, "
          f"{with_peaks} waveforms ({len(fresh['peaks'])} decoded, {with_peaks - len(fresh['peaks'])} cached), "
          f"{with_lyrics} lyrics ({synced} synced; {lyrics_written} written, {lyrics_removed} removed), "
          f"{with_spectrum} spectrograms ({len(fresh['quality'])} analysed), "
          + ", ".join(f"{verdicts[v]} {v}" for v in quality.VERDICTS)
          + f" -> {os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
