// Album cover in a fixed square box (no layout shift). Fades in on load; cached images appear
// at once. Albums without art get a quiet placeholder.
import { coverUrl } from "../lib/format";
import { Icon } from "./icons";

interface Props {
	albumId: string | null | undefined;
	hasCover: boolean;
	/** Rendered size hint for the placeholder icon */
	size?: number;
	class?: string;
	eager?: boolean;
	alt?: string;
}

function onLoad(e: Event) {
	(e.currentTarget as HTMLImageElement).dataset.loaded = "";
}

function onError(e: Event) {
	(e.currentTarget as HTMLImageElement).dataset.failed = "";
}

export function Cover({ albumId, hasCover, size = 48, class: cls = "", eager = false, alt = "" }: Props) {
	return (
		<span class={`cover ${cls}`}>
			<Icon name="musicNote" size={Math.max(16, Math.round(size * 0.28))} class="cover-ph" />
			{albumId && hasCover && (
				<img
					key={albumId}
					src={coverUrl(albumId)}
					alt={alt}
					width={512}
					height={512}
					loading={eager ? "eager" : "lazy"}
					decoding="async"
					draggable={false}
					onLoad={onLoad}
					onError={onError}
					ref={(img) => {
						// Already decoded (memory cache): show without a fade.
						if (img?.complete && img.naturalWidth > 0) img.dataset.loaded = "instant";
					}}
				/>
			)}
		</span>
	);
}
