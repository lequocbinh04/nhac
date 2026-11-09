#!/usr/bin/env python3
"""Generate a synthetic demo music library for nhac: screenshots, demos and contributors.

Everything here is original: fictional artists and albums, chord pads and arpeggios synthesised by
ffmpeg's aevalsrc, and abstract covers in tools/demo/covers/ (generated once with an image model from
the prompts listed in ALBUMS; no text, logos or people). No copyrighted recordings are involved.

Writes <out>/<Album artist>/<Album>/<NN - Title>.flac with full tags (title, artist, album,
album_artist, track, disc, date, genre) and the cover embedded, in a realistic spread of formats:
16-bit/44.1 kHz, 24/48, 24/96 and one 24/192 album. Output is deterministic for a given script version.

Requires ffmpeg on PATH. Python 3.9+, standard library only.
"""
import argparse, os, random, shutil, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
COVERS = os.path.join(HERE, "demo", "covers")
SYNTH_RATE = 24000  # Synthesis rate; content stays below 6 kHz, then it is resampled to the album's rate.

# Chord progressions as semitone offsets from the key root.
PROGRESSIONS = {
    "pop": [[0, 4, 7, 12], [7, 11, 14, 19], [9, 12, 16, 21], [5, 9, 12, 17]],      # I V vi IV
    "dream": [[0, 4, 7, 11], [5, 9, 12, 16], [0, 4, 7, 11], [5, 9, 12, 16]],       # Imaj7 IVmaj7
    "jazz": [[2, 5, 9, 12], [7, 11, 14, 17], [0, 4, 7, 11], [9, 12, 16, 19]],      # ii V I vi
    "minor": [[0, 3, 7, 10], [8, 12, 15, 19], [3, 7, 10, 14], [10, 14, 17, 22]],   # i VI III VII
    "still": [[0, 7, 12, 16], [5, 12, 17, 21], [-3, 4, 9, 12], [0, 7, 12, 16]],
}

ALBUMS = [
    {"slug": "mua-ha-trong-veo", "title": "Mùa Hạ Trong Veo", "artist": "Hạ Vy Ensemble", "year": "2025",
     "genre": "Indie Pop", "sr": 44100, "bits": 16, "key": 64, "bpm": 96, "prog": ["pop", "dream"],
     "cover": "soft photographic abstract of sunlight through a pale turquoise swimming pool surface",
     "tracks": ["Nắng Đầu Ngõ", "Trưa Hè Không Gió", "Gửi Ve Sầu", "Hồ Bơi Lúc Ba Giờ", "Mây Trắng Bay Ngang",
                "Chiều Trong Veo"]},
    {"slug": "glass-harbor", "title": "Glass Harbor", "artist": "The Quiet Engines", "year": "2023",
     "genre": "Ambient", "sr": 48000, "bits": 24, "key": 57, "bpm": 70, "prog": ["dream", "still"],
     "cover": "minimal geometric overlapping translucent rectangles, slate blue and fog grey on paper",
     "tracks": ["Low Tide Signal", "Ferry at 6:40", "Salt on the Lens", "Harbor Lights, Unlit", "Breakwater"]},
    {"slug": "dem-sai-gon", "title": "Đêm Sài Gòn", "artist": "Lặng Collective", "year": "2024",
     "genre": "Lo-fi", "sr": 96000, "bits": 24, "key": 62, "bpm": 82, "prog": ["jazz", "minor"],
     "cover": "risograph abstract night cityscape, deep ink blue and warm coral, halftone grain",
     "tracks": ["Cầu Ánh Sao", "Quán Khuya", "Mưa Trên Mái Tôn", "Xe Ôm Lúc 2 Giờ"]},
    {"slug": "northern-lines", "title": "Northern Lines", "artist": "Ada Wren & Field Notes", "year": "2022",
     "genre": "Folk", "sr": 44100, "bits": 16, "key": 60, "bpm": 88, "prog": ["pop", "still"], "discs": [4, 3],
     "cover": "35mm film grain photograph of a minimal snowy plain horizon, muted cool palette",
     "tracks": ["First Snow", "Fence Posts", "Kettle Song", "Map Without Roads", "Whiteout", "Low Sun", "Thaw"]},
    {"slug": "hoi-tho-cua-gio", "title": "Hơi Thở Của Gió", "artist": "Gió Lộng Trio", "year": "2025",
     "genre": "Acoustic", "sr": 48000, "bits": 24, "key": 65, "bpm": 92, "prog": ["dream", "pop"],
     "cover": "long-exposure photograph of tall grass bending in wind, sage green and cream, film grain",
     "tracks": ["Cỏ Lau Ven Đồi", "Thả Diều", "Gió Mùa Về", "Ngủ Quên Trên Đồi", "Đường Về Nhà"]},
    {"slug": "small-hours", "title": "Small Hours", "artist": "Ferro & Lune", "year": "2026",
     "genre": "Modern Classical", "sr": 192000, "bits": 24, "key": 55, "bpm": 60, "prog": ["still", "minor"],
     "cover": "minimal thin circle and horizontal line on deep charcoal, warm off-white line",
     "tracks": ["Nocturne in Grey", "3:12 a.m.", "Before the Birds"], "max_dur": 30},
    {"slug": "mua-vang-tren-pho", "title": "Mưa Vàng Trên Phố", "artist": "Tiệm Mưa", "year": "2024",
     "genre": "Ballad", "sr": 44100, "bits": 16, "key": 58, "bpm": 76, "prog": ["minor", "pop"],
     "cover": "risograph rain streaks and soft round shapes, teal and mustard on cream paper",
     "tracks": ["Mưa Vàng Trên Phố", "Hiên Nhà Ai", "Ô Xanh Ô Vàng", "Giọt Cuối Mùa", "Đèn Đường Bật Sớm", "Tạnh"]},
    {"slug": "static-bloom", "title": "Static Bloom", "artist": "Velvet Cartography", "year": "2026",
     "genre": "Electronic", "sr": 96000, "bits": 24, "key": 61, "bpm": 112, "prog": ["minor", "jazz"],
     "cover": "macro photograph of ink blooming in water, deep indigo and soft amber on near-black",
     "tracks": ["Ink in Water", "Carrier Wave", "Bloom (Interlude)", "Night Bus Polyphony", "Afterimage",
                "Soft Static", "Undertow", "Last Light Loop"],
     "features": {3: "Hạ Vy Ensemble"}},
]


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def pick(index, values):
    """ffmpeg expression selecting values[index] for an integer-valued expression `index`."""
    expr = f"{values[-1]:.4f}"
    for i in range(len(values) - 2, -1, -1):
        expr = f"if(eq({index},{i}),{values[i]:.4f},{expr})"
    return expr


def channel_expr(rng, album, dur, detune, pan):
    """One stereo channel: crossfaded chord pad, bass, and a plucked arpeggio with an arrangement arc."""
    prog = PROGRESSIONS[rng.choice(album["prog"])]
    root = album["key"] + rng.choice([0, 0, -2, 3, 5]) - 12
    beat = 60 / album["bpm"]
    bar = beat * 4
    n = len(prog)
    u = f"mod(t/{bar:.5f},{n})"
    parts = []
    for k, chord in enumerate(prog):
        # Trapezoid gate around chord k: flat for most of the bar, 0.2-bar linear crossfade, sums to 1.
        d = f"(mod({u}-{k + 0.5}+{n / 2 + n},{n})-{n / 2})"
        gate = f"clip((0.6-abs({d}))/0.2,0,1)"
        tones = "+".join(
            f"0.075*sin(2*PI*{hz(root + 12 + s) * detune:.4f}*t)+0.018*sin(4*PI*{hz(root + 12 + s) * detune:.4f}*t)"
            for s in chord)
        bass = f"0.13*sin(2*PI*{hz(root + chord[0] - (12 if chord[0] >= 0 else 0)):.4f}*t)"
        parts.append(f"{gate}*({tones}+{bass})")
    pad = "+".join(parts)
    # Slow breathing on the pad and a dip two thirds in, so waveforms show real structure.
    dip = f"(1-0.55*clip(1-abs(t-{dur * 0.62:.2f})/{dur * 0.07:.2f},0,1))"
    pad = f"(0.82+0.18*sin(2*PI*t/{bar * 2:.4f}))*{dip}*({pad})"

    step = beat / rng.choice([2, 2, 4])
    pattern = rng.choice([[0, 1, 2, 3], [0, 2, 1, 3], [0, 1, 2, 3, 2, 1], [3, 2, 1, 0]])
    j = f"mod(floor(t/{step:.5f}),{len(pattern)})"
    c = f"floor({u})"
    freqs = [pick(j, [hz(root + 24 + chord[p]) for p in pattern]) for chord in prog]
    freq = freqs[-1]
    for i in range(n - 2, -1, -1):
        freq = f"if(eq({c},{i}),{freqs[i]},{freq})"
    tau = f"mod(t,{step:.5f})"
    pluck = f"(1-exp(-{tau}*300))*exp(-{tau}*{3.5 / step:.3f})"
    side = f"(0.75+0.25*(1-2*mod(floor(t/{step:.5f}),2))*{pan})"
    # The arpeggio enters after the intro and leaves before the outro.
    arc = f"clip((t-{dur * 0.18:.2f})/2,0,1)*clip(({dur * 0.86:.2f}-t)/2,0,1)"
    arp = f"0.16*{arc}*{side}*{pluck}*sin(2*PI*{freq}*t)" if rng.random() < 0.85 else "0"
    return f"{pad}+{arp}"


def render(job):
    album, idx, title, path, dur, cover, disc, n = job
    rng = random.Random(f"{album['slug']}/{idx}")
    # Both channels share one seed, so chords and arpeggio match; only detune and arpeggio panning differ.
    seed = rng.random()
    left = channel_expr(random.Random(seed), album, dur, 1.0, 1)
    right = channel_expr(random.Random(seed), album, dur, 1.0018, -1)
    sample_fmt = "s16" if album["bits"] == 16 else "s32"
    graph = (f"aevalsrc=exprs='{left}|{right}':s={SYNTH_RATE}:d={dur},"
             f"lowpass=f=5200,aecho=0.8:0.6:{int(rng.uniform(180, 320))}|{int(rng.uniform(380, 560))}:0.28|0.18,"
             f"afade=t=in:d=1.5,afade=t=out:st={dur - 3.5}:d=3.5,volume=2,alimiter=limit=0.9:level=false,"
             f"aresample={album['sr']},aformat=sample_fmts={sample_fmt}[a]")
    discs = album.get("discs") or [len(album["tracks"])]
    artist = album["artist"] + (f"; {album['features'][idx]}" if idx in album.get("features", {}) else "")
    tags = {"title": title, "artist": artist, "album": album["title"], "album_artist": album["artist"],
            "track": f"{n}/{discs[disc - 1]}", "disc": f"{disc}/{len(discs)}", "date": album["year"],
            "genre": album["genre"]}
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", cover, "-filter_complex", graph, "-map", "[a]", "-map", "0:v",
           "-c:a", "flac", "-compression_level", "8", "-c:v", "copy", "-disposition:v", "attached_pic",
           "-metadata:s:v", "comment=Cover (front)"]
    if album["bits"] == 24:
        cmd += ["-bits_per_raw_sample", "24"]
    for k, v in tags.items():
        cmd += ["-metadata", f"{k}={v}"]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    result = subprocess.run(cmd + [path], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed for {path}:\n{result.stderr[-2000:]}")
    return path


def safe(name):
    return "".join("_" if ch in '/\\:*?"<>|' else ch for ch in name).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("out", nargs="?", default="demo-music", help="output folder (default: demo-music)")
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    args = parser.parse_args()
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH")

    jobs = []
    for album in ALBUMS:
        cover = os.path.join(COVERS, f"{album['slug']}.jpg")
        if not os.path.exists(cover):
            sys.exit(f"missing cover {cover}")
        rng = random.Random(album["slug"])
        discs = album.get("discs") or [len(album["tracks"])]
        folder = os.path.join(args.out, safe(album["artist"]), safe(album["title"]))
        for idx, title in enumerate(album["tracks"]):
            dur = rng.randint(20, album.get("max_dur", 60))
            disc, n = 1, idx + 1
            while n > discs[disc - 1]:
                n -= discs[disc - 1]
                disc += 1
            name = f"{disc}-{n:02d} - {safe(title)}.flac" if len(discs) > 1 else f"{n:02d} - {safe(title)}.flac"
            jobs.append((album, idx, title, os.path.join(folder, name), dur, cover, disc, n))

    started = time.time()
    with ThreadPoolExecutor(args.jobs) as pool:
        for i, path in enumerate(pool.map(render, jobs), 1):
            print(f"[{i}/{len(jobs)}] {os.path.relpath(path, args.out)}", flush=True)
    size = sum(os.path.getsize(j[3]) for j in jobs)
    print(f"\n{len(jobs)} tracks in {len(ALBUMS)} albums, {size / 1e6:.1f} MB, {time.time() - started:.0f} s "
          f"-> {os.path.abspath(args.out)}")
    print("\nNext steps:\n"
          f"  python3 tools/build_library.py {args.out} --out demo-library-data\n"
          f"  then upload {args.out}/ to the bucket root and demo-library-data/ to <bucket>/_nhac/ (see README).")


if __name__ == "__main__":
    main()
