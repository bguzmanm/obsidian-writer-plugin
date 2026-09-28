import { App, TFile } from "obsidian";
import { FM, ItemType } from "../types";

/** Lee una clave de frontmatter sea del tipo que sea. */
export function fmGet(file: TFile, key: string): unknown {
	const cache = (file as TFile & { __bwCache?: Record<string, unknown> }).__bwCache;
	if (cache && key in cache) return cache[key];

	// getFrontMatter vive en el prototype del archivo en versiones antiguas
	const anyFile = file as unknown as { getFrontMatter?: () => Record<string, unknown> };
	const data = anyFile.getFrontMatter ? anyFile.getFrontMatter() : {};
	return data[key];
}

export function fmString(file: TFile, key: string, fallback = ""): string {
	const v = fmGet(file, key);
	if (v === undefined || v === null) return fallback;
	if (typeof v === "string") return v;
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return fallback;
}

export function fmNumber(file: TFile, key: string, fallback = 0): number {
	const v = fmGet(file, key);
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string") {
		const n = Number(v);
		if (Number.isFinite(n)) return n;
	}
	return fallback;
}

/** Lee una lista de cadenas (bw_characters, bw_tags…), sea inline o en bloque. */
export function fmStringList(file: TFile, key: string): string[] {
	const v = fmGet(file, key);
	if (!Array.isArray(v)) return [];
	return v
		.map((x) => (x === null || x === undefined ? "" : String(x).trim()))
		.filter((s) => s !== "");
}

/** Lee el tipo de nota ("scene", "character"…). */
export function itemType(file: TFile): ItemType | "" {
	return fmString(file, FM.TYPE) as ItemType;
}

export function isType(file: TFile, type: ItemType): boolean {
	return fmString(file, FM.TYPE) === type;
}

export function belongsTo(file: TFile, book: string): boolean {
	const b = fmString(file, FM.BOOK);
	// las notas sin bw_book se asignan al primer libro (manuscritos previos)
	return b === book || b === "";
}

/** Añade claves bw_* al frontmatter sin tocar el resto. */
export async function writeFrontMatter(
	app: App,
	file: TFile,
	patch: Record<string, unknown>
): Promise<void> {
	const data: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;
		data[key] = value;
	}

	await app.fileManager.processFrontMatter(file, (front) => {
		Object.assign(front, data);
	});

	// limpia la caché local para que fmGet vuelva a leer
	delete (file as TFile & { __bwCache?: Record<string, unknown> }).__bwCache;
}

/** Saca el nombre de la primera línea o del nombre de archivo. */
/** Saca el nombre de la primera línea o del nombre de archivo. */
export function noteTitle(file: TFile, source: string): string {
	const heading = source.match(/^\s{0,3}#{1,6}\s+(.+)$/m);
	if (heading) return heading[1].trim();
	return file.basename;
}

/**
 * Extrae el cuerpo sin el frontmatter, que es lo que se cuenta como palabras
 * del manuscrito. Si no hay frontmatter o no se cierra, devuelve la nota tal cual.
 */
export function bodyOf(source: string): string {
	const block = frontMatterBlock(source);
	if (block === null) return source;
	return source.slice(block.end).replace(/^\r?\n/, "");
}

/** Localiza el bloque de frontmatter: devuelve su texto y dónde acaba. */
function frontMatterBlock(source: string): { text: string; end: number } | null {
	if (!source.startsWith("---")) return null;

	const openEnd = source.indexOf("\n", 3);
	if (openEnd === -1) return null;

	// el cierre es una línea "---": localizamos el salto que la precede
	const closeStart = source.indexOf("\n---", openEnd);
	if (closeStart === -1) return null;

	return { text: source.slice(openEnd + 1, closeStart), end: closeStart + 4 };
}

/**
 * Frontmatter leído del texto de la nota, no de la caché de metadatos.
 *
 * La caché de Obsidian se rellena de forma asíncrona: nada más crear una nota
 * esta ya existe en el vault, pero `getFrontMatter()` todavía no la ve. Como el
 * panel se dibuja justo después de crear, leer de ahí hacía que capítulos y
 * escenas nuevas no aparecieran hasta recargar a mano el vault.
 *
 * Se parsea el bloque con un parser propio: `parseFrontMatterEntry` de Obsidian
 * espera el objeto ya parseado (no el texto), así que no se puede usar para
 * leer una nota recién creada. El resultado es un objeto completo de primer
 * nivel, como el que daría la caché cuando está al día.
 */
export function frontMatterOf(source: string): Record<string, unknown> {
	const block = frontMatterBlock(source);
	if (block === null) return {};
	return parseFrontmatterBlock(block.text);
}

/**
 * Parser mínimo de YAML para el subconjunto que escribe el plugin (y Obsidian
 * al serializar el frontmatter): claves de primer nivel con valores escalares,
 * listas inline ("clave: [a, b]"), listas en bloque ("clave:" seguida de líneas
 * "  - a") y listas en bloque de objetos ("  - título: X\n    orden: 1").
 */
export function parseFrontmatterBlock(text: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = text.split("\n");

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const match = /^([\w-]+):(?:\s(.*))?$/.exec(line);
		if (!match) {
			i += 1;
			continue;
		}

		const key = match[1];
		let raw = match[2] ?? "";

		// "clave:" sin valor: puede abrir una lista en bloque
		if (raw === "") {
			const block = collectBlock(lines, i + 1);
			if (block.length > 0) {
				result[key] = parseBlock(block);
				i += 1 + block.length;
				continue;
			}
			result[key] = null;
			i += 1;
			continue;
		}

		// lista inline: [a, b]
		if (raw.startsWith("[")) {
			result[key] = parseInlineList(raw);
			i += 1;
			continue;
		}

		result[key] = yamlScalar(raw.trim());
		i += 1;
	}

	return result;
}

/** Reúne las líneas sangradas que siguen a una línea "clave:". */
function collectBlock(lines: string[], from: number): string[] {
	const block: string[] = [];
	for (let i = from; i < lines.length; i += 1) {
		if (!/^\s+\S/.test(lines[i])) break;
		block.push(lines[i]);
	}
	return block;
}

/**
 * Parsea el cuerpo sangrado de una lista en bloque:
 *   - a
 *   - b
 * o bien una lista de objetos:
 *   - title: X
 *     folderName: Y
 *     order: 1
 */
function parseBlock(block: string[]): unknown {
	const isObjectList = block.some((l) => /^\s+-\s+[\w-]+:/.test(l));
	if (!isObjectList) {
		return block
			.map((l) => l.replace(/^\s+-\s+/, ""))
			.map((l) => yamlScalar(l.trim()))
			.filter((v) => v !== null);
	}

	const items: Record<string, unknown>[] = [];
	let current: Record<string, unknown> | null = null;

	for (const line of block) {
		const entry = /^\s+-\s+([\w-]+):(?:\s(.*))?$/.exec(line);
		if (entry) {
			if (current) items.push(current);
			current = { [entry[1]]: entry[2] === undefined ? null : yamlScalar(entry[2].trim()) };
			continue;
		}
		const prop = /^\s+([\w-]+):(?:\s(.*))?$/.exec(line);
		if (prop && current) {
			current[prop[1]] = prop[2] === undefined ? null : yamlScalar(prop[2].trim());
		}
	}
	if (current) items.push(current);
	return items;
}

/** Lista inline: "[a, b]" o "[1, 2]". Soporta también listas de objetos. */
function parseInlineList(raw: string): unknown {
	const inside = raw.slice(1, raw.lastIndexOf("]"));
	const chunks = inside.split(",").map((s) => s.trim());

	if (chunks.some((c) => /^[\w-]+:/.test(c))) {
		return chunks
			.map((c) => {
				const entry = /^([\w-]+):\s*(.*)$/.exec(c);
				if (!entry) return null;
				return { [entry[1]]: entry[2] === "" ? null : yamlScalar(entry[2]) };
			})
			.filter((v) => v !== null);
	}
	return chunks.map((c) => yamlScalar(c)).filter((v) => v !== null);
}

/** Convierte un valor YAML escalar a su tipo. */
function yamlScalar(raw: string): unknown {
	const v = raw.trim();
	if (v === "" || v === "null" || v === "~") return null;
	if (v === "true") return true;
	if (v === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
	if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"');
	if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
	return v;
}

/**
 * Vista de una nota con su frontmatter ya leído del texto, para poder pasarla
 * a `fmString`/`fmNumber` sin que vuelvan a la caché.
 */
export function noteView(file: TFile, source: string): TFile {
	return Object.create(file, {
		__bwCache: { value: frontMatterOf(source), enumerable: false },
	}) as TFile;
}
