// library.json contract, produced by tools/build_library.py and served by GET /api/library.

export interface Track {
	id: string;
	/** Bucket key, may contain "/" */
	file: string;
	title: string;
	artist: string;
	n: number;
	disc: number;
	year: string;
	genre: string;
	/** Seconds */
	dur: number;
	size: number;
	/** ffprobe codec name: flac, alac, pcm_s24le, aac, mp3, ... */
	codec: string;
	sr: number;
	/** 0 for lossy codecs */
	bits: number;
	albumId: string;
	/** Optional base64 of 96 unsigned bytes: waveform amplitude bins over the whole track */
	peaks?: string;
	/** Lyrics available at GET /lyrics/<id>: LRC ("synced") or plain text */
	lyrics?: "synced" | "plain";
	/** A spectrogram image is served at GET /spectrum/<id> */
	spectrum?: true;
	/** Authenticity analysis of the audio content (absent when not analysed) */
	quality?: TrackQuality;
}

/**
 * lossless: content reaches (close to) Nyquist with real low-order bits. lossy: a lossy encoder's
 * brickwall low-pass inside a lossless container. upsampled: a lower rate or bit depth padded to
 * hi-res. unknown: too short, quiet or ambiguous to judge.
 */
export type QualityVerdict = "lossless" | "upsampled" | "lossy" | "unknown";

export interface TrackQuality {
	verdict: QualityVerdict;
	/** Highest frequency with real content, Hz */
	cutoffHz: number;
	/** Bits actually used when fewer than the container's */
	effectiveBits?: number;
	/** Language-neutral source token: "44.1k", "48k", "44.1/48k", "16-bit", "44.1k/16-bit", "MP3/AAC", ... */
	source?: string;
	/** 0..1 */
	confidence: number;
}

export interface Album {
	id: string;
	title: string;
	artist: string;
	year: string;
	genre: string;
	trackIds: string[];
	cover: boolean;
}

export interface LibraryData {
	version: string;
	stats: { tracks: number; albums: number; bytes: number; seconds: number; quality?: Partial<Record<QualityVerdict, number>> };
	albums: Album[];
	tracks: Track[];
}
