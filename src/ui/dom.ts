import { App, TFile } from "obsidian";

/** Crea un elemento con clases y opcionalmente texto. */
export function make(
	tag: string,
	cls?: string,
	text?: string
): HTMLElement {
	const el = document.createElement(tag);
	if (cls) el.className = cls;
	if (text !== undefined) el.textContent = text;
	return el;
}

export function div(cls?: string, text?: string): HTMLDivElement {
	return make("div", cls, text) as HTMLDivElement;
}

export function span(cls?: string, text?: string): HTMLSpanElement {
	return make("span", cls, text) as HTMLSpanElement;
}

/**
 * Enlace que abre una nota en el editor.
 *
 * El stopPropagation importa: sin él, el clic sigue subiendo hasta el editor y
 * puede interpretarse como parte de la nota abierta. El href hace que el
 * comando "Abrir enlace en pestaña nueva" de Obsidian también funcione.
 */
export function link(app: App, file: TFile, text?: string): HTMLElement {
	const label = text ?? file.basename;
	const el = make("a", "bw-link", label);
	el.setAttribute("href", `#${file.path}`);
	el.title = `Abrir ${label}`;
	el.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		void app.workspace.getLeaf(false).openFile(file);
	});
	return el;
}

/**
 * Botón del panel.
 *
 * Devuelve el HTMLElement pelado a propósito: envolverlo en el
 * ButtonComponent de Obsidian añade la clase "clickable-icon", que impone
 * anchura y altura de icono y deja el texto fuera de la vista.
 *
 * El primer argumento es siempre el texto visible. `title` añade el tooltip,
 * que es lo que hace falta cuando el texto es corto o un icono.
 */
export function button(
	text: string,
	onClick: (ev: MouseEvent) => void,
	opts: { cls?: string; title?: string } = {}
): HTMLButtonElement {
	const el = make("button", `bw-btn ${opts.cls ?? ""}`.trim(), text) as HTMLButtonElement;
	el.type = "button";

	const title = opts.title ?? text;
	el.title = title;
	el.setAttribute("aria-label", title);

	el.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		onClick(ev as MouseEvent);
	});

	return el;
}

/** Fila etiqueta + valor. */
export function statRow(label: string, value: string, extra = ""): HTMLElement {
	const row = div(`bw-stat ${extra}`.trim());
	row.appendChild(span("bw-stat-label", label));
	row.appendChild(span("bw-stat-value", value));
	return row;
}

/** Barra de progreso horizontal, 0..1. */
export function progressBar(ratio: number, cls = ""): HTMLElement {
	const wrap = div(`bw-progress ${cls}`.trim());
	const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
	wrap.setAttribute("role", "progressbar");
	wrap.setAttribute("aria-valuenow", String(Math.round(clamped * 100)));
	wrap.setAttribute("aria-valuemin", "0");
	wrap.setAttribute("aria-valuemax", "100");
	const fill = div("bw-progress-fill");
	fill.style.width = `${clamped * 100}%`;
	wrap.appendChild(fill);
	return wrap;
}

export function section(title: string, collapsed = false): HTMLDetailsElement {
	const details = make("details", "bw-section") as HTMLDetailsElement;
	const summary = make("summary", "bw-section-title", title);
	details.appendChild(summary);
	if (!collapsed) details.setAttribute("open", "");
	return details;
}

export function empty(message: string): HTMLElement {
	return div("bw-empty", message);
}

/** Formatea milares con punto, estilo español. */
export function num(n: number): string {
	return new Intl.NumberFormat("es-ES").format(Math.round(n));
}
