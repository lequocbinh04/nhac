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
	stats: { tracks: number; albums: number; bytes: number; seconds: number };
	albums: Album[];
	tracks: Track[];
}
