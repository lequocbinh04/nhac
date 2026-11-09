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

Requires ffmpeg and ffprobe on PATH. Python 3.9+, standard library only.
"""
import argparse, array, base64, collections, hashlib, json, math, os, subprocess, sys, unicodedata
from concurrent.futures import ThreadPoolExecutor

AUDIO_EXTENSIONS = (".flac", ".m4a", ".mp3", ".wav", ".aiff", ".aif", ".ogg", ".opus")
PEAK_BINS = 96
PEAKS_CACHE_VERSION = 1


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
    tags, audio, has_cover = {}, None, False
    for stream in info.get("streams", []):
        tags.update({k.lower(): v for k, v in (stream.get("tags") or {}).items()})
        if stream.get("codec_type") == "audio" and audio is None:
            audio = stream
        elif stream.get("codec_type") == "video":
            has_cover = True
    tags.update({k.lower(): v for k, v in (info.get("format", {}).get("tags") or {}).items()})
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


def index_file(root, key, cache, fresh):
    track = probe(root, key)
    if track is None:
        return None
    cache_key = peaks_cache_key(root, key)
    if cache_key in cache:
        peaks = cache[cache_key]
    else:
        peaks = compute_peaks(os.path.join(root, key))
        if peaks is not None:
            fresh[cache_key] = peaks
    track["_peaks"] = peaks
    track["_peaksKey"] = cache_key
    return track


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("music_dir", help="local folder that mirrors the bucket's music files")
    parser.add_argument("--out", default="library-data", help="output folder (default: library-data)")
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    args = parser.parse_args()

    root = os.path.abspath(args.music_dir)
    covers_dir = os.path.join(args.out, "covers")
    os.makedirs(covers_dir, exist_ok=True)

    keys = sorted(
        os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/")
        for d, _, files in os.walk(root) for f in files
        if f.lower().endswith(AUDIO_EXTENSIONS) and not f.startswith("."))
    peaks_cache_path = os.path.join(args.out, "peaks-cache.json")
    cache, fresh = load_peaks_cache(peaks_cache_path), {}
    with ThreadPoolExecutor(args.jobs) as pool:
        tracks = [t for t in pool.map(lambda k: index_file(root, k, cache, fresh), keys) if t]
    if not tracks:
        sys.exit(f"no audio files found under {root}")
    # Keep only entries for files that still exist, so the cache never grows without bound.
    kept = {t["_peaksKey"]: t["_peaks"] for t in tracks if t["_peaks"] is not None}
    with open(peaks_cache_path, "w", encoding="utf-8") as f:
        json.dump({"version": PEAKS_CACHE_VERSION, "entries": kept}, f, ensure_ascii=False, separators=(",", ":"))

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
    for t in tracks:
        peaks = t["_peaks"]
        for k in ("_cover", "albumTitle", "albumArtist", "_peaks", "_peaksKey"):
            del t[k]
        if peaks is not None:
            t["peaks"] = peaks

    albums.sort(key=lambda a: (fold(a["artist"]), fold(a["title"])))
    library = {
        "version": hashlib.sha1("\n".join(t["file"] for t in tracks).encode()).hexdigest()[:10],
        "stats": {"tracks": len(tracks), "albums": len(albums), "bytes": sum(t["size"] for t in tracks),
                  "seconds": round(sum(t["dur"] for t in tracks))},
        "albums": albums,
        "tracks": tracks,
    }
    with open(os.path.join(args.out, "library.json"), "w", encoding="utf-8") as f:
        json.dump(library, f, ensure_ascii=False, separators=(",", ":"))
    with_peaks = sum(1 for t in tracks if "peaks" in t)
    print(f"{len(tracks)} tracks, {len(albums)} albums, {len(with_cover)} covers, "
          f"{with_peaks} waveforms ({len(fresh)} decoded, {with_peaks - len(fresh)} cached) -> {os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
