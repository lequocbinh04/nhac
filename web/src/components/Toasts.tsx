import { toasts } from "../lib/toast";

export function Toasts() {
	return (
		<div class="toasts" role="status" aria-live="polite">
			{toasts.value.map((t) => (
				<div key={t.id} class="toast" data-leaving={t.leaving ? "" : undefined}>
					{t.text}
				</div>
			))}
		</div>
	);
}
