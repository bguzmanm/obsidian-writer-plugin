import { createFakeDocument } from "./dom-stub";
import { TFile } from "./obsidian-stub";
import { button, div, empty, link, make, progressBar, section, span, statRow } from "../src/ui/dom";

/** dom.ts llama a document.createElement en tiempo de uso, así que basta instalarlo. */
const doc = createFakeDocument();
(globalThis as { document?: unknown }).document = doc;

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		pass += 1;
	} else {
		fail += 1;
		console.log(`  FALLO  ${name}\n         esperado: ${e}\n         obtenido: ${a}`);
	}
}

function heading(name: string): void {
	console.log(`\n${name}`);
}

// ---------------------------------------------------------------- botones

heading("botones: texto visible");

const plain = button("Crear capítulo", () => {});
check("el texto del botón es su texto", plain.textContent, "Crear capítulo");
check("no lleva la clase que impone Obsidian a sus iconos", plain.classList.contains("clickable-icon"), false);
check("no lleva aria-label vacío", plain.getAttribute("aria-label"), "Crear capítulo");
check("el title por defecto es el texto", plain.title, "Crear capítulo");
check("es un button de tipo button", plain.type, "button");

const withTitle = button("⋯", () => {}, { title: "Acciones del libro" });
check("admite un texto corto", withTitle.textContent, "⋯");
check("pero con un title que lo explica", withTitle.title, "Acciones del libro");
check("y el aria-label dice lo mismo", withTitle.getAttribute("aria-label"), "Acciones del libro");

const styled = button("Escribir", () => {}, { cls: "bw-btn-primary" });
check("acepta clases extra", styled.className, "bw-btn bw-btn-primary");
check("y no añade basura con la clase vacía", button("X", () => {}).className, "bw-btn");

// ------------------------------------------------------- botones: clic

heading("botones: el clic hace algo");

let clicks = 0;
let lastEvent: MouseEvent | undefined;
const counter = button("Sumar", (ev) => {
	clicks += 1;
	lastEvent = ev;
});

check("nadie ha pulsado todavía", clicks, 0);
counter.fire("click", { button: 0 });
check("el clic llega al manejador", clicks, 1);
check("y recibe el evento del ratón", lastEvent?.button, 0);
counter.fire("click", { button: 0 });
check("un segundo clic también cuenta", clicks, 2);

// el elemento recién creado está desconectado, pero el listener vive en él
const holder = div("holder");
const inTree = button("Dentro", () => {});
holder.appendChild(inTree);
check("el botón está en el árbol", holder.children.length, 1);
inTree.fire("click");
check("y sigue funcionando dentro del árbol", inTree.textContent, "Dentro");

// ---------------------------------------------------------------- helpers

heading("helpers de construcción");

check("make con texto", make("h1", "titulo", "Hola").textContent, "Hola");
check("make sin texto", make("h1", "titulo").textContent, "");
check("div con clase y texto", div("a", "b").className, "a");
check("span anidado recoge el texto del padre", (() => {
	const p = div("p");
	p.appendChild(span("s", "hola"));
	p.appendChild(span("s", " mundo"));
	return p.textContent;
})(), "hola mundo");

check("empty es un aviso visual", empty("Nada todavía").className, "bw-empty");

const bar = progressBar(0.5);
check("la barra tiene su relleno al 50%", bar.children[0].style.width, "50%");
check("y expone el valor a los lectores de pantalla", bar.getAttribute("aria-valuenow"), "50");

check("la barra no se sale por arriba", progressBar(3).children[0].style.width, "100%");
check("ni por abajo", progressBar(-1).children[0].style.width, "0%");
check("y tolera un NaN sin romperse", progressBar(Number.NaN).children[0].style.width, "0%");

const row = statRow("Palabras", "120 / 500");
check("la fila lleva etiqueta y valor", row.textContent, "Palabras120 / 500");
check("con dos hijos", row.children.length, 2);

const sec = section("Capítulo 1");
check("la sección trae su título", sec.children[0].textContent, "Capítulo 1");
check("y va abierta por defecto", sec.getAttribute("open"), "");
const closed = section("Capítulo 2", true);
check("una sección plegada no lleva el atributo open", closed.getAttribute("open"), null);

// ----------------------------------------------------------- enlaces

heading("enlaces a notas");

// El enlace sólo abre si lo que devuelve el vault es un TFile de verdad, así que
// el test crea instancias de la misma clase que usa el código (vía el alias del
// build). Si no fuera la misma clase, el instanceof fallaría y la prueba
// detectaría el enlace roto.
function note(path: string): TFile {
	const f = new TFile() as TFile & { path: string; basename: string };
	f.path = path;
	f.basename = (path.split("/").pop() ?? path).replace(/\.md$/, "");
	return f;
}

const existing = note("Escenas/Escena 1.md");
const opened: string[] = [];
const fakeApp = {
	workspace: {
		getLeaf: () => ({ openFile: (f: TFile) => opened.push((f as TFile & { path: string }).path) }),
	},
} as never;

const anchor = link(fakeApp, existing);
check("el enlace usa el nombre del archivo", anchor.textContent, "Escena 1");
check("es una etiqueta, no un botón", anchor.tagName, "A");
check("lleva el href de la nota", anchor.getAttribute("href"), "#Escenas/Escena 1.md");
check("y un title que lo explica", anchor.title, "Abrir Escena 1");

anchor.fire("click");
check("al pulsarlo abre la nota", opened, ["Escenas/Escena 1.md"]);

let stopped = false;
anchor.fire("click", {
	stopPropagation: () => {
		stopped = true;
	},
});
check("y el clic no sube al editor", stopped, true);

const titled = link(fakeApp, existing, "La llegada");
check("se puede acortar el texto", titled.textContent, "La llegada");
check("pero el title nombra la nota real", titled.title, "Abrir La llegada");
titled.fire("click");
check("y abre la misma nota", opened.length, 3);

// ------------------------------------------- refresco del panel sin perder

heading("el panel no se queda sin refrescar");

/**
 * Reproduce la ráfaga de eventos del vault al crear un capítulo: se llama a
 * render() mientras el dibujado anterior sigue en curso. Antes esa llamada se
 * descartaba y el panel se quedaba con los datos viejos, así que el capítulo
 * no aparecía aunque el archivo existiera.
 */
class PanelLike {
	rendering = false;
	renderQueued = false;
	draws = 0;

	render(): void {
		if (this.rendering) {
			this.renderQueued = true;
			return;
		}
		this.rendering = true;
		this.draws += 1;
		void Promise.resolve().then(() => {
			this.rendering = false;
			if (this.renderQueued) {
				this.renderQueued = false;
				this.render();
			}
		});
	}
}

const panel = new PanelLike();
panel.render();
check("el primer dibujado ocurre", panel.draws, 1);

// llegan tres eventos seguidos, con el panel ocupado
panel.render();
panel.render();
panel.render();
check("mientras dibuja no se solapan dibujos", panel.draws, 1);
check("pero se recuerda que hay que repetir", panel.renderQueued, true);

await new Promise((r) => setTimeout(r, 10));
check("al terminar se dibuja otra vez", panel.draws, 2);
check("y no se queda con la marca puesta", panel.renderQueued, false);

await new Promise((r) => setTimeout(r, 10));
check("sin encadenar dibujos infinitos", panel.draws, 2);

// -------------------------------------------------------------- resumen

console.log(`\n${"=".repeat(50)}`);
console.log(`${pass} correctas, ${fail} fallidas`);
process.exit(fail === 0 ? 0 : 1);
