#!/usr/bin/env python3
"""Spectrogram image and "is this lossless file really lossless?" verdict for one audio file.

Used by build_library.py; run it directly to inspect files: python3 tools/quality.py FILE... (prints the
verdict and the measured features; add --png DIR to also write the spectrogram images there).

One ffmpeg pass per file decodes the first audio stream, mixes it to mono and renders `showspectrumpic`
(Blackman-Harris window, linear frequency axis, 150 dB gray scale, every column the average of all FFT
frames in its slice of the track) twice from the same analysis: 1200x1024 for measuring and 1200x400 for
the picture. 24- and 32-bit files also pass through `astats`, whose bit-depth mask tells whether the low
8 bits carry anything.

Measuring: per frequency row, the mean level over time and the spread between its quiet and loud moments
(p90 - p10). Music moves with the song; a lossy encoder's empty band, a resampler's stop band or a shelf of
dither is a flat floor (or digital zero). A row counts as content when it is above -122 dBFS per bin and
its spread is at least 10 dB. The content edge (cutoffHz) is the highest frequency, ignoring the top 1.5%
of the band, where content rows dominate the 400 Hz below. The wall is the loudest level 300-1200 Hz below
the edge minus the mean level 200-1000 Hz above it. MP3 without a low-pass is caught at its top
scale-factor band (16.0 kHz at 44.1k, 17.4 kHz at 48k): a step below the spectrum's own trend there, plus
extra frame-to-frame flicker above it.

Verdicts; confidence is 0..1, and lossy / upsampled need >= 0.7, below that the verdict is unknown and
the confidence says how suspicious the file looked:
- lossy: an edge below 20.9 kHz with a wall of 22 dB (15 dB over a flat shelf) and only floor above it
  (MP3 128k ~16 kHz, AAC 128k ~18 kHz, MP3 320k and Opus ~20-20.5 kHz; below 19.5 kHz 0.95, or 0.85 over a
  shelf; at 19.5-20.9 kHz 0.8, where a steep mastering filter is the innocent explanation);
  or an MP3 top-band step of 5.5 dB (4 dB with step + flicker >= 6.5; 0.9 when the sum reaches 10, else
  0.75), cutoffHz then being that band's start; or a lossy codec (MP3, AAC, ...) outright (1.0).
- upsampled: an 88.2 kHz+ file whose content stops below 26.5 kHz (source "44.1k", "48k" or "44.1/48k" by
  edge; 0.95 with a wall, else 0.8), or whose spectrum above 22.05 / 24 kHz mirrors the band below it
  (correlation >= 0.8: an upsampler without an anti-imaging filter; 0.9), or a 24/32-bit file whose samples
  use at most 16 bits ("16-bit"; 0.95). Rate and bits join as e.g. "44.1k/16-bit". Lossy wins over both.
- lossless: content up to at least 20.9 kHz, or a gentle roll-off ending at 19.5 kHz or higher.
- unknown: shorter than 8 s, too quiet or not decodable (0), a gentle roll-off below 19.5 kHz such as an
  old master (0.4), or a 19.5-20.9 kHz edge over a flat shelf whose wall is under 22 dB (0.6).
Limits: high-bitrate AAC keeps everything up to ~22 kHz and passes as lossless, as does a lossy source
whose own cutoff was above 20.9 kHz; a master deliberately low-passed below 20.9 kHz with a steep filter
reads as lossy; a 24-bit file made from a 16-bit source with any gain change uses all 24 bits; a 44.1/48k
master upsampled and then processed at the high rate (limiter, EQ, noise) gains faint real content above
24 kHz and passes as lossless.

The picture: time left to right over the whole track, 0 Hz at the bottom row to sr/2 at the top row (no
padding, axes or legend), -130..-25 dBFS per bin mapped to 64 colors from the app's ink through teal to
near-white. Written as WebP when ffmpeg has libwebp, otherwise as an 8-bit palette PNG.

Standard library only; needs ffmpeg on PATH.
"""
import functools, os, re, struct, subprocess, zlib

WIDTH, HEIGHT = 1200, 400          # spectrogram picture
ANALYSIS_ROWS = 1024               # frequency rows measured (21.5 Hz each at 44.1 kHz)
DRANGE = 150                       # dB covered by the gray scale: gray 0 = -150 dB, 255 = 0 dB per bin
PER_DB = 255 / DRANGE
CONTENT_LEVEL = 28                 # dB above -150: below this a row is floor however much it moves
CONTENT_SPREAD = 10                # dB between a row's p10 and p90 over time
LOSSY_EDGE = 20900                 # Hz: a walled edge below this is a lossy encoder's low-pass
GENTLE_EDGE = 19500                # Hz: a gentle roll-off ending above this still counts as lossless
HIRES_EDGE = 26500                 # Hz: a hi-res file with no content above this came from 44.1/48k
WALL_DB = 22                      # dB drop at the edge that makes it a wall
SHELF_WALL_DB = 15                # enough when a flat shelf of dither or hiss sits above the edge
SFB21_HZ = (16000, 17417)         # start of MP3's top scale-factor band at 44.1k and 48k
STEP_DB = 5.5                     # MP3 top-band step alone; 4 dB suffices when step + flicker >= 6.5
MIRROR_R = 0.8                    # spectrum mirrored around 22.05/24 kHz this well: an imaging upsampler
MIN_SECONDS = 8
MIN_CONFIDENCE = 0.7
LOSSY_CODECS = {"mp3", "mp2", "aac", "opus", "vorbis", "ac3", "eac3", "wmav1", "wmav2", "wmapro", "dts", "amr_nb", "amr_wb"}
VERDICTS = ("lossless", "upsampled", "lossy", "unknown")

# Picture colors: the app's --bg-deep through deep ink and teal to near-white.
COLOR_STOPS = ((0.0, (0x07, 0x0b, 0x0e)), (0.25, (0x0c, 0x1d, 0x2a)), (0.5, (0x13, 0x4a, 0x55)),
               (0.72, (0x3a, 0x9a, 0x93)), (0.88, (0x8f, 0xd6, 0xc9)), (1.0, (0xf4, 0xfb, 0xf9)))
PICTURE_DB = (20, 125)             # dB above -150 mapped to the first and last palette entry
PALETTE_SIZE = 64


def _palette():
    colors = []
    for i in range(PALETTE_SIZE):
        x = i / (PALETTE_SIZE - 1)
        (x0, c0), (x1, c1) = next((a, b) for a, b in zip(COLOR_STOPS, COLOR_STOPS[1:]) if x <= b[0])
        t = (x - x0) / (x1 - x0)
        colors.append(bytes(round(a + (b - a) * t) for a, b in zip(c0, c1)))
    lo, hi = PICTURE_DB
    index = bytes(min(PALETTE_SIZE - 1, max(0, round((g / PER_DB - lo) / (hi - lo) * (PALETTE_SIZE - 1))))
                  for g in range(256))
    return b"".join(colors), index


PALETTE, GRAY_TO_INDEX = _palette()


def _png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def encode_png(gray, width, height):
    """8-bit palette PNG of a gray picture; the 'Up' filter on the quantized rows roughly halves the size."""
    rows = [gray[y * width:(y + 1) * width].translate(GRAY_TO_INDEX) for y in range(height)]
    raw = [b"\x00" + rows[0]]
    raw += [b"\x02" + bytes((a - b) & 255 for a, b in zip(row, prev)) for prev, row in zip(rows, rows[1:])]
    return (b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 3, 0, 0, 0))
            + _png_chunk(b"PLTE", PALETTE) + _png_chunk(b"IDAT", zlib.compress(b"".join(raw), 9))
            + _png_chunk(b"IEND", b""))


@functools.lru_cache(maxsize=None)
def has_webp():
    out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    return re.search(r"^\s*V\S*\s+libwebp\s", out, re.M) is not None


def encode_picture(gray):
    """(bytes, extension) of the spectrogram picture."""
    png = encode_png(gray, WIDTH, HEIGHT)
    if has_webp():
        webp = subprocess.run(["ffmpeg", "-v", "error", "-f", "png_pipe", "-i", "-", "-c:v", "libwebp",
                               "-quality", "80", "-f", "webp", "-"], input=png, capture_output=True)
        if webp.returncode == 0 and webp.stdout:
            return webp.stdout, "webp"
    return png, "png"


def render(path, check_bits):
    """(analysis gray rows top-down, picture gray, effective bits or None), or None when ffmpeg fails."""
    chain = "[0:a:0]"
    if check_bits:
        chain += "aformat=sample_fmts=s32,astats=measure_perchannel=none:measure_overall=Bit_depth,"
    chain += (f"aformat=sample_fmts=fltp:channel_layouts=mono,showspectrumpic=s={WIDTH}x{ANALYSIS_ROWS}:legend=0:"
              f"color=channel:saturation=0:win_func=bharris:drange={DRANGE},format=gray,split[a][b];"
              f"[b]scale={WIDTH}:{HEIGHT}:flags=area[p];[a][p]vstack")
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-v", "info", "-i", path, "-filter_complex", chain,
                           "-frames:v", "1", "-f", "rawvideo", "-"], capture_output=True)
    if proc.returncode != 0 or len(proc.stdout) != WIDTH * (ANALYSIS_ROWS + HEIGHT):
        return None
    bits = None
    if check_bits:
        found = re.findall(rb"Bit depth: ([\d/]+)", proc.stderr)
        if found:
            bits = max(int(b) for b in found[-1].split(b"/"))
    split = WIDTH * ANALYSIS_ROWS
    return proc.stdout[:split], proc.stdout[split:], bits


def measure(gray, sr):
    """Features of the analysis picture: rows indexed from 0 Hz upwards."""
    nyq = sr / 2
    hz_per_row = nyq / (ANALYSIS_ROWS - 1)
    level, spread = [0.0] * ANALYSIS_ROWS, [0.0] * ANALYSIS_ROWS
    p10, p90 = WIDTH // 10, WIDTH * 9 // 10
    rough = [0.0] * ANALYSIS_ROWS
    rough_rows = range(round(14000 / hz_per_row), min(ANALYSIS_ROWS, round(19500 / hz_per_row) + 1))
    for y in range(ANALYSIS_ROWS):
        row = gray[(ANALYSIS_ROWS - 1 - y) * WIDTH:(ANALYSIS_ROWS - y) * WIDTH]
        ordered = sorted(row)
        level[y] = sum(row) / WIDTH / PER_DB
        spread[y] = (ordered[p90] - ordered[p10]) / PER_DB
        if y in rough_rows:
            # Mean jump between neighbouring columns: how much the row flickers over time.
            rough[y] = sum(map(abs, map(int.__sub__, row[1:], row[:-1]))) / (WIDTH - 1) / PER_DB

    def at(hz):
        return min(ANALYSIS_ROWS - 1, max(0, round(hz / hz_per_row)))

    def mean(values, lo_hz, hi_hz):
        a, b = at(lo_hz), at(hi_hz)
        part = values[a:b + 1] if b >= a else []
        return sum(part) / len(part) if part else 0.0

    # Smooth over ~3 rows so a single hot or cold bin cannot decide the edge.
    smooth = [sum(level[max(0, y - 1):y + 2]) / len(level[max(0, y - 1):y + 2]) for y in range(ANALYSIS_ROWS)]
    content = [smooth[y] >= CONTENT_LEVEL and spread[y] >= CONTENT_SPREAD for y in range(ANALYSIS_ROWS)]
    top = int((ANALYSIS_ROWS - 1) * 0.985)
    span = max(2, round(400 / hz_per_row))
    edge_row = None
    for y in range(top, at(1000), -1):
        if content[y]:
            window = content[max(0, y - span):y + 1]
            if sum(window) >= 0.6 * len(window):
                edge_row = y
                break
    reference = max(level[at(100):at(5000) + 1])  # the loudest band: tells music from near-silence
    if edge_row is None:
        return {"edge": 0, "wall": 0.0, "above": 0.0, "aboveSpread": 0.0, "reference": round(reference, 1),
                "step": 0.0, "flicker": 0.0, "stepHz": 0, "mirror": 0.0, "mirrorHz": 0}
    edge = nyq if edge_row == top else edge_row * hz_per_row  # content right up to the top: no edge at all
    below = max(level[at(edge - 1200):at(edge - 300) + 1] or [level[edge_row]])
    if at(edge + 200) >= top:
        above, above_spread, wall = smooth[top], spread[top], 0.0
    else:
        above = mean(level, edge + 200, min(edge + 1000, top * hz_per_row))
        above_spread = mean(spread, edge + 200, min(edge + 1000, top * hz_per_row))
        wall = below - above
    # MP3's top band (from 16.0 kHz at 44.1k, 17.4 kHz at 48k) has no scale factor of its own, so encoders
    # without a low-pass code it coarsely: it sits below the spectrum's own trend (step) and switches on and
    # off from frame to frame (flicker: its column-to-column jumps minus those just below the boundary).
    # Genuine masters run smoothly through both boundaries.
    step = flicker = 0.0
    step_hz = 0
    for boundary in SFB21_HZ:
        if boundary + 1000 > edge or boundary + 1000 > nyq:
            continue
        below_level = mean(level, boundary - 600, boundary - 100)
        trend = mean(level, boundary - 1200, boundary - 700) - below_level
        s = below_level - mean(level, boundary + 100, boundary + 600) - max(0.0, trend)
        f = mean(rough, boundary + 100, min(boundary + 1500, edge)) - mean(rough, boundary - 1500, boundary - 100)
        if s + f > step + flicker:
            step, flicker, step_hz = s, f, boundary
    # A hi-res file upsampled without an anti-imaging filter carries a mirror image of the music above the
    # source's Nyquist: the spectrum rises again, so the levels at fn + x track those at fn - x. Real content
    # keeps falling (a strongly negative correlation).
    mirror, mirror_hz = 0.0, 0
    if sr >= 88200:
        for fn in (22050, 24000):
            r = _correlation([smooth[at(fn - x)] for x in range(500, 8001, 100)],
                             [smooth[at(fn + x)] for x in range(500, 8001, 100)])
            if r > mirror:
                mirror, mirror_hz = r, fn
    return {"edge": round(edge), "wall": round(wall, 1), "above": round(above, 1),
            "aboveSpread": round(above_spread, 1), "reference": round(reference, 1),
            "step": round(step, 1), "flicker": round(flicker, 1), "stepHz": step_hz,
            "mirror": round(mirror, 2), "mirrorHz": mirror_hz}


def _correlation(a, b):
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    sa = sum((x - ma) ** 2 for x in a) ** 0.5
    sb = sum((y - mb) ** 2 for y in b) ** 0.5
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (sa * sb) if sa and sb else 0.0


def rate_source(edge):
    # Upsamplers' transition bands reach 0.5-1.5 kHz past the source's Nyquist (22.05 or 24 kHz).
    if edge < 23500:
        return "44.1k"
    return "44.1/48k" if edge < 24300 else "48k"


def verdict(features, *, sr, bits, codec, dur, effective_bits):
    """The quality object for library.json from measured features (see the module docstring)."""
    edge, wall = features["edge"], features["wall"]
    q = {"verdict": "unknown", "cutoffHz": int(round(edge, -2)), "confidence": 0.0}
    if effective_bits is not None:
        q["effectiveBits"] = effective_bits
    if codec in LOSSY_CODECS:
        q.update(verdict="lossy", source="MP3/AAC", confidence=1.0)
        return q
    if dur < MIN_SECONDS or features["reference"] < 50 or edge < 2000:
        return q
    # A lossy encoder's low-pass leaves only floor above it: too quiet to be content, or a flat shelf of
    # dither or hiss that does not move with the music.
    flat_above = features["aboveSpread"] < CONTENT_SPREAD
    walled = wall >= WALL_DB and (flat_above or features["above"] < CONTENT_LEVEL)
    cutoff_confidence = 0.0
    if edge < LOSSY_EDGE and (walled or (wall >= SHELF_WALL_DB and flat_above)):
        cutoff_confidence = (0.95 if walled else 0.85) if edge < GENTLE_EDGE else (0.8 if walled else 0.6)
    step, flicker = features["step"], features["flicker"]
    step_confidence = 0.0
    if step >= STEP_DB or (step >= STEP_DB - 1.5 and step + flicker >= STEP_DB + 1):
        step_confidence = 0.9 if step + flicker >= 10 else 0.75
    if max(cutoff_confidence, step_confidence) >= MIN_CONFIDENCE:
        if step_confidence > cutoff_confidence:
            q["cutoffHz"] = features["stepHz"]
        q.update(verdict="lossy", source="MP3/AAC", confidence=max(cutoff_confidence, step_confidence))
        return q
    sources, confidence = [], 1.0
    if sr >= 88200 and edge < HIRES_EDGE:
        sources.append(rate_source(edge))
        confidence = 0.95 if wall >= WALL_DB else 0.8
    elif sr >= 88200 and features["mirror"] >= MIRROR_R:
        sources.append("44.1k" if features["mirrorHz"] == 22050 else "48k")
        q["cutoffHz"] = features["mirrorHz"]
        confidence = 0.9
    if bits > 16 and effective_bits is not None and effective_bits <= 16:
        sources.append("16-bit")
        confidence = min(confidence, 0.95)
    if sources:
        q.update(verdict="upsampled", source="/".join(sources), confidence=confidence)
    elif cutoff_confidence:
        q["confidence"] = cutoff_confidence  # unknown: a wall that may be a lossy encoder's or a mastering filter
    elif edge >= LOSSY_EDGE:
        q.update(verdict="lossless", confidence=0.95 if edge >= 0.95 * min(sr / 2, 24000) or sr >= 88200 else 0.9)
    elif edge >= GENTLE_EDGE:
        q.update(verdict="lossless", confidence=0.75)
    else:
        q["confidence"] = 0.4  # unknown: a gentle roll-off below 19.5 kHz, an old master or a soft lossy filter
    return q


def analyse(path, *, sr, bits, codec, dur):
    """(quality, picture bytes, picture extension); picture is None when ffmpeg cannot decode the file."""
    unknown = {"verdict": "unknown", "cutoffHz": 0, "confidence": 0.0}
    if sr <= 0:
        return unknown, None, None
    rendered = render(path, check_bits=bits > 16 and codec not in LOSSY_CODECS)
    if rendered is None:
        return unknown, None, None
    analysis, picture, effective_bits = rendered
    quality = verdict(measure(analysis, sr), sr=sr, bits=bits, codec=codec, dur=dur, effective_bits=effective_bits)
    data, ext = encode_picture(picture)
    return quality, data, ext


def _probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                          "stream=codec_name,sample_rate,bits_per_raw_sample,bits_per_sample:format=duration",
                          "-of", "default=nw=1", path], capture_output=True, text=True).stdout
    info = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    raw = info.get("bits_per_raw_sample", "0")
    bits = raw if raw.isdigit() and raw != "0" else info.get("bits_per_sample", "0")
    return {"codec": info.get("codec_name", ""), "sr": int(info.get("sample_rate") or 0),
            "bits": int(bits) if bits.isdigit() else 0, "dur": float(info.get("duration") or 0)}


def main():
    import argparse, json
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+")
    parser.add_argument("--png", help="also write each spectrogram picture into this folder")
    args = parser.parse_args()
    for path in args.files:
        info = _probe(path)
        rendered = render(path, check_bits=info["bits"] > 16 and info["codec"] not in LOSSY_CODECS)
        if rendered is None:
            print(json.dumps({"file": path, "error": "decode failed"}, ensure_ascii=False))
            continue
        features = measure(rendered[0], info["sr"])
        quality = verdict(features, effective_bits=rendered[2], **info)
        print(json.dumps({"file": os.path.basename(path), **{k: info[k] for k in ("sr", "bits")}, **features,
                          "effectiveBits": rendered[2], **quality}, ensure_ascii=False))
        if args.png:
            os.makedirs(args.png, exist_ok=True)
            data, ext = encode_picture(rendered[1])
            with open(os.path.join(args.png, os.path.splitext(os.path.basename(path))[0] + "." + ext), "wb") as f:
                f.write(data)


if __name__ == "__main__":
    main()
