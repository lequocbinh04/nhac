import { toasts } from "../lib/toast";

/** Select the whole link on focus/click so it can be copied by hand. */
function selectAll(e: Event) {
	const sel = getSelection();
	const el = e.currentTarget as HTMLElement;
	if (!sel) return;
	const range = document.createRange();
	range.selectNodeContents(el);
	sel.removeAllRanges();
	sel.addRange(range);
}

export function Toasts() {
	return (
		<div class="toasts" role="status" aria-live="polite">
			{toasts.value.map((t) => (
				<div key={t.id} class="toast" data-leaving={t.leaving ? "" : undefined} data-detail={t.detail ? "" : undefined}>
					{t.text}
					{t.detail && (
						<span class="toast-detail mono" tabIndex={0} onFocus={selectAll} onClick={selectAll}>
							{t.detail}
						</span>
					)}
				</div>
			))}
		</div>
	);
}
