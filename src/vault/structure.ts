import { App, Notice, TAbstractFile, TFolder, TFile, Vault, normalizePath } from "obsidian";
import { WriterSettings } from "../settings";
import { countWords } from "../stats/count";
import { ChapterRef, FM, ItemType, SceneStatus } from "../types";
import { writeFrontMatter, frontMatterOf, bodyOf } from "./schema";

export const FOLDER = {
	manuscript: "Manuscrito",
	characters: "Personajes",
	world: "Mundo",
	journal: "Registro",
} as const;

/** Quita caracteres no permitidos en rutas de Obsidian. */
export function sanitizeName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Rellena con ceros a la izquierda: 1 -> "01". */
export function pad(n: number, width = 2): string {
	return String(Math.max(1, Math.floor(n))).padStart(width, "0");
}

/** Evita que dos archivos o carpetas صرén en el mismo nombre. */
export function uniquePath(vault: Vault, path: string): string {
	if (!vault.getAbstractFileByPath(path)) return path;
	const ext = path.endsWith(".md") ? ".md" : "";
	const base = ext ? path.slice(0, -ext.length) : path;
	const dot = base.lastIndexOf(".");
	const stem = dot === -1 ? base : base.slice(0, dot);
	let i = 2;
	while (vault.getAbstractFileByPath(`${stem} ${i}${ext}`)) i += 1;
	return `${stem} ${i}${ext}`;
}

export function bookRoot(settings: WriterSettings, book: string): string {
	return normalizePath(`${settings.booksFolder}/${sanitizeName(book)}`);
}

export function chapterPath(settings: WriterSettings, book: string, chapter: ChapterRef): string {
	return normalizePath(`${bookRoot(settings, book)}/${FOLDER.manuscript}/${chapter.folderName}`);
}

export function dailyLogPath(settings: WriterSettings, book: string, date: string): string {
	return normalizePath(`${bookRoot(settings, book)}/${FOLDER.journal}/${date}.md`);
}

export async function ensureFolder(vault: Vault, path: string): Promise<TFolder> {
	const existing = vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return existing;
	await vault.createFolder(path);
	const created = vault.getAbstractFileByPath(path);
	if (!(created instanceof TFolder)) throw new Error(`No se pudo crear la carpeta ${path}`);
	return created;
}

async function ensureSubfolders(vault: Vault, root: string): Promise<void> {
	for (const sub of [FOLDER.manuscript, FOLDER.characters, FOLDER.world, FOLDER.journal]) {
		await ensureFolder(vault, normalizePath(`${root}/${sub}`));
	}
}

export interface BookStructure {
	root: string;
	rootNote: TFile;
}

/** vault.create devuelve TAbstractFile en los tipos, pero siempre crea un TFile. */
function asFile(f: TAbstractFile | null): TFile | null {
	return f instanceof TFile ? f : null;
}

/**
 * Crea la carpeta del libro con sus cuatro subcarpetas, la nota índice del
 * manuscrito y la nota raíz del libro.
 */
export async function createBook(app: App, settings: WriterSettings, book: string): Promise<BookStructure> {
	const { vault } = app;
	const root = bookRoot(settings, book);

	await ensureFolder(vault, root);
	await ensureSubfolders(vault, root);

	const index = await ensureScenesIndex(app, settings, book);

	if (!index) throw new Error("No se pudo crear la nota índice del manuscrito");

	const rootNotePath = normalizePath(`${root}/${book}.md`);
	const rootNote =
		asFile(vault.getAbstractFileByPath(rootNotePath)) ??
		asFile(
			await vault.create(
				rootNotePath,
				`# ${book}\n\n## Premisa\n\n## Tesis / tema\n\n## Sinopsis\n\n## Tono y voz\n\n## Personajes principales\n\n## Estructura de tres actos\n`
			)
		);

	if (!rootNote) throw new Error("No se pudo crear la nota raíz del libro");

	await writeFrontMatter(app, rootNote, {
		[FM.TYPE]: "book" satisfies ItemType,
		[FM.BOOK]: book,
		[FM.NAME]: book,
		[FM.STATUS]: "escribiendo",
		[FM.GOAL]: settings.bookGoal,
		[FM.START]: new Date().toISOString().slice(0, 10),
	});

	return { root, rootNote };
}

/** Ruta de la nota índice del manuscrito de un libro. */
function scenesIndexPath(settings: WriterSettings, book: string): string {
	return normalizePath(`${bookRoot(settings, book)}/${FOLDER.manuscript}/Manuscrito.md`);
}

/**
 * Devuelve la nota índice del manuscrito, creándola si no existe. Así un libro
 * creado antes de que el plugin guardara capítulos en el índice (o con la
 * estructura a medio hacer) se puede seguir usando sin recargar a mano.
 */
export async function ensureScenesIndex(
	app: App,
	settings: WriterSettings,
	book: string
): Promise<TFile> {
	const indexPath = scenesIndexPath(settings, book);
	const existing = asFile(app.vault.getAbstractFileByPath(indexPath));
	if (existing) return existing;

	const root = bookRoot(settings, book);
	await ensureFolder(app.vault, root);
	await ensureFolder(app.vault, normalizePath(`${root}/${FOLDER.manuscript}`));

	const created = asFile(await app.vault.create(indexPath, INDEX_TEMPLATE));
	if (!created) throw new Error("No se pudo crear la nota índice del manuscrito");

	await writeFrontMatter(app, created, {
		[FM.TYPE]: "chapter" satisfies ItemType,
		[FM.BOOK]: book,
		[FM.NAME]: "Manuscrito",
		[FM.ORDER]: 0,
		[FM.CHAPTERS]: [],
	});

	return created;
}

/**
 * Lee la lista de capítulos guardada en la nota índice del manuscrito,
 * completándola con las carpetas `Manuscrito/NN - Título` que aún no estén
 * registradas (libros creados antes del índice, capítulos hechos a mano).
 *
 * Se lee el texto y no la caché: justo tras crear un capítulo el índice
 * todavía no está en la caché de metadatos y el capítulo no aparecería.
 * La carpeta real manda sobre el índice: si cambias el nombre a mano del
 * capítulo, el título del índice queda atrás, y en vez de vértelo el plugin
 * respeta la carpeta y reescribe el índice al añadir el siguiente capítulo.
 */
export async function readChapters(app: App, settings: WriterSettings, book: string): Promise<ChapterRef[]> {
	const indexPath = scenesIndexPath(settings, book);
	const index = app.vault.getAbstractFileByPath(indexPath);

	let fromIndex: ChapterRef[] = [];
	if (index instanceof TFile) {
		fromIndex = readChapterRefs(frontMatterOf(await app.vault.read(index)));
	}

	const merged = [...fromIndex];
	for (const ref of chapterRefsFromFolders(app, settings, book)) {
		if (!merged.some((c) => c.folderName === ref.folderName)) merged.push(ref);
	}

	return merged.sort((a, b) => a.order - b.order);
}

/** Deduce los capítulos de las carpetas `NN - Título` de Manuscrito/. */
export function chapterRefsFromFolders(app: App, settings: WriterSettings, book: string): ChapterRef[] {
	const folderPath = normalizePath(`${bookRoot(settings, book)}/${FOLDER.manuscript}`);
	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) return [];

	const refs: ChapterRef[] = [];
	for (const child of folder.children) {
		if (!(child instanceof TFolder)) continue;
		const m = /^(\d+)\s*-\s*(.+)$/.exec(child.name);
		if (!m) continue;
		refs.push({
			title: m[2].trim(),
			folderName: child.name,
			order: Number(m[1]),
		});
	}
	return refs;
}

function readChapterRefs(front: Record<string, unknown>): ChapterRef[] {
	const raw = front[FM.CHAPTERS];
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
		.map((c) => ({
			title: String(c.title ?? "Sin título"),
			folderName: String(c.folderName ?? c.title ?? "Capitulo"),
			order: Number(c.order ?? 0),
		}));
}

export async function addChapterRef(
	app: App,
	settings: WriterSettings,
	book: string,
	ref: ChapterRef
): Promise<void> {
	// se crea el índice si no existe: un libro viejo (sin nota índice) no debe
	// quedarse sin poder guardar sus capítulos
	const index = await ensureScenesIndex(app, settings, book);

	// se parte de la vista completa (índice + carpetas heredadas) para no
	// perder los capítulos que aún no estaban en el índice
	const existing = (await readChapters(app, settings, book)).filter((c) => c.title !== ref.title);
	existing.push(ref);
	existing.sort((a, b) => a.order - b.order);
	await writeFrontMatter(app, index, { [FM.CHAPTERS]: existing });
}

export async function removeChapterRef(
	app: App,
	settings: WriterSettings,
	book: string,
	title: string
): Promise<void> {
	const indexPath = scenesIndexPath(settings, book);
	const index = app.vault.getAbstractFileByPath(indexPath);
	if (!(index instanceof TFile)) return;
	const remaining = readChapterRefs(frontMatterOf(await app.vault.read(index))).filter(
		(c) => c.title !== title
	);
	await writeFrontMatter(app, index, { [FM.CHAPTERS]: remaining });
}

/**
 * Crea un capítulo: carpeta con nota índice, lista de escenas y escena inicial.
 */
export async function createChapter(
	app: App,
	settings: WriterSettings,
	book: string,
	title: string
): Promise<{ folder: string; firstScene: TFile | null }> {
	const clean = sanitizeName(title) || "Capítulo sin título";
	const chapters = await readChapters(app, settings, book);
	const order = chapters.reduce((max, c) => Math.max(max, c.order), 0) + 1;
	const folderName = `${pad(order)} - ${clean}`;

	const folder = normalizePath(`${bookRoot(settings, book)}/${FOLDER.manuscript}/${folderName}`);
	await ensureFolder(app.vault, folder);

	const chapterNotePath = normalizePath(`${folder}/${clean}.md`);
	if (!(app.vault.getAbstractFileByPath(chapterNotePath) instanceof TFile)) {
		await app.vault.create(chapterNotePath, `# ${clean}\n\n${CHAPTER_TEMPLATE}`);
	}

	await addChapterRef(app, settings, book, { title: clean, folderName, order });

	const first = await createScene(app, settings, book, { title: "Escena 1", chapterTitle: clean });
	return { folder, firstScene: first };
}

/** Crea una escena dentro de un capítulo. */
export async function createScene(
	app: App,
	settings: WriterSettings,
	book: string,
	opts: {
		title: string;
		chapterTitle: string;
		order?: number;
		status?: SceneStatus;
		pov?: string;
		characters?: string[];
	}
): Promise<TFile> {
	const { vault } = app;
	const chapters = await readChapters(app, settings, book);
	const chapter =
		chapters.find((c) => c.title.toLowerCase() === opts.chapterTitle.toLowerCase()) ??
		chapters[chapters.length - 1];

	if (!chapter) {
		new Notice("Crea un capítulo antes de añadir escenas.");
		throw new Error("Sin capítulos");
	}

	const folder = normalizePath(`${bookRoot(settings, book)}/${FOLDER.manuscript}/${chapter.folderName}`);
	await ensureFolder(vault, folder);

	const order = opts.order ?? (await nextSceneOrder(app, folder)) + 1;
	const clean = sanitizeName(opts.title) || `Escena ${order}`;
	const path = uniquePath(vault, normalizePath(`${folder}/${pad(order)} - ${clean}.md`));

	const file = asFile(
		await vault.create(
			path,
			[
				`# ${clean}`,
				"",
				`> **POV:** ${opts.pov ?? "—"}   **Estado:** ${opts.status ?? "draft"}   **Palabras:** 0`,
				"",
				"## Sinopsis",
				"",
				"## Escena",
				"",
			].join("\n")
		)
	);

	if (!file) throw new Error(`No se pudo crear la escena ${path}`);

	await writeFrontMatter(app, file, {
		[FM.TYPE]: "scene" satisfies ItemType,
		[FM.BOOK]: book,
		[FM.CHAPTER]: chapter.title,
		[FM.ORDER]: order,
		[FM.STATUS]: opts.status ?? "draft",
		[FM.POV]: opts.pov ?? "",
		[FM.CHARACTERS]: opts.characters ?? [],
		[FM.ESTIMATE]: 0,
	});

	// la nota del capítulo lleva la lista de escenas para poder consultarla
	await appendSceneToChapterNote(app, folder, chapter.title, clean);
	return file;
}

async function nextSceneOrder(app: App, folder: string): Promise<number> {
	const files = app.vault
		.getMarkdownFiles()
		.filter((f) => f.parent?.path === folder);
	let max = 0;
	for (const f of files) {
		const m = f.basename.match(/^(\d+)/);
		if (m) max = Math.max(max, Number(m[1]));
	}
	return max;
}

/**
 * Actualiza la línea de cabecera de una escena
 * (`> **POV:** … **Estado:** … **Palabras:** n`) con el frontmatter actual.
 * Se llama tras cambiar POV, estado o al terminar una sesión; así la cabecera
 * no se queda con el valor del momento de crear la escena.
 */
export async function updateSceneHeader(
	app: App,
	settings: WriterSettings,
	file: TFile
): Promise<void> {
	const mkline = (source: string) => {
		const front = frontMatterOf(source);
		if (front[FM.TYPE] !== "scene" && front[FM.CHAPTER] === undefined) return null;

		const pov = String(front[FM.POV] ?? "");
		const status = String(front[FM.STATUS] ?? "draft");
		const words = countWords(bodyOf(source), {
			countHeadings: settings.countHeadings,
		}).words;
		return `> **POV:** ${pov || "—"}   **Estado:** ${status}   **Palabras:** ${words}`;
	};

	// process hace el leer+modificar+escribir atómico: si la nota está abierta
	// en el editor, no se pierde el cursor
	await app.vault.process(file, (source) => {
		if (!/^>\s*\*\*POV:\*\*.*$/m.test(source)) return source;
		const line = mkline(source);
		if (line === null) return source;
		return source.replace(/^>\s*\*\*POV:\*\*.*$/m, line);
	});
}

async function appendSceneToChapterNote(
	app: App,
	folder: string,
	chapterTitle: string,
	sceneTitle: string
): Promise<void> {
	const path = normalizePath(`${folder}/${chapterTitle}.md`);
	const note = asFile(app.vault.getAbstractFileByPath(path));
	if (!note) return;

	const link = `- [[${sceneTitle}]]`;
	const content = await app.vault.read(note);
	if (content.includes(`[[${sceneTitle}]]`)) return;

	const marker = "## Escenas";
	if (content.includes(marker)) {
		const updated = content.replace(marker, `${marker}\n\n${link}`);
		await app.vault.modify(note, updated);
	} else {
		await app.vault.append(note, `\n\n${marker}\n\n${link}\n`);
	}
}

/** Crea una ficha de personaje. */
export async function createCharacter(
	app: App,
	settings: WriterSettings,
	book: string,
	name: string,
	role: "protagonist" | "antagonist" | "secondary" | "minor" = "secondary"
): Promise<TFile> {
	const clean = sanitizeName(name) || "Personaje sin nombre";
	const folder = normalizePath(`${bookRoot(settings, book)}/${FOLDER.characters}`);
	await ensureFolder(app.vault, folder);

	const path = uniquePath(app.vault, normalizePath(`${folder}/${clean}.md`));
	const file = asFile(await app.vault.create(path, characterTemplate(clean, role)));
	if (!file) throw new Error(`No se pudo crear la ficha ${path}`);

	await writeFrontMatter(app, file, {
		[FM.TYPE]: "character" satisfies ItemType,
		[FM.BOOK]: book,
		[FM.NAME]: clean,
		[FM.ROLE]: role,
		[FM.STATUS]: "activo",
		[FM.APPEARS]: 0,
	});

	await linkFromRootNote(app, settings, book, `[[${clean}]]`, "## Personajes principales");
	return file;
}

/** Crea una ficha de mundo (lugar, objeto, facción, concepto…). */
export async function createWorldEntry(
	app: App,
	settings: WriterSettings,
	book: string,
	name: string,
	kind: string
): Promise<TFile> {
	const clean = sanitizeName(name) || "Elemento sin nombre";
	const folder = normalizePath(`${bookRoot(settings, book)}/${FOLDER.world}`);
	await ensureFolder(app.vault, folder);

	const path = uniquePath(app.vault, normalizePath(`${folder}/${clean}.md`));
	const file = asFile(
		await app.vault.create(
			path,
			`# ${clean}\n\n**Tipo:** ${kind}\n\n## Descripción\n\n## Detalles\n\n## Relación con la trama\n\n## Menciones\n`
		)
	);
	if (!file) throw new Error(`No se pudo crear la ficha ${path}`);

	await writeFrontMatter(app, file, {
		[FM.TYPE]: "world" satisfies ItemType,
		[FM.BOOK]: book,
		[FM.NAME]: clean,
		[FM.KIND]: kind,
	});

	await linkFromRootNote(app, settings, book, `[[${clean}]]`, "## Estructura de tres actos");
	return file;
}

async function linkFromRootNote(
	app: App,
	settings: WriterSettings,
	book: string,
	link: string,
	marker: string
): Promise<void> {
	const rootPath = normalizePath(`${bookRoot(settings, book)}/${book}.md`);
	const note = asFile(app.vault.getAbstractFileByPath(rootPath));
	if (!note) return;

	const content = await app.vault.read(note);
	if (content.includes(link)) return;

	if (content.includes(marker)) {
		await app.vault.modify(note, content.replace(marker, `${marker}\n\n${link}`));
	} else {
		await app.vault.append(note, `\n\n${marker}\n\n${link}\n`);
	}
}

/** Devuelve (creando si hace falta) la nota de registro del día. */
export async function getOrCreateDailyLog(
	app: App,
	settings: WriterSettings,
	book: string,
	date: string
): Promise<TFile> {
	const folder = normalizePath(`${bookRoot(settings, book)}/${FOLDER.journal}`);
	await ensureFolder(app.vault, folder);

	const path = dailyLogPath(settings, book, date);
	const existing = asFile(app.vault.getAbstractFileByPath(path));
	if (existing) return existing;

	const file = asFile(
		await app.vault.create(
			path,
			`# ${date}\n\n## Sesiones\n\n| Inicio | Fin | Minutos | Palabras | Notas |\n| --- | --- | --- | --- | --- |\n\n## Notas del día\n`
		)
	);
	if (!file) throw new Error(`No se pudo crear el registro ${path}`);

	await writeFrontMatter(app, file, {
		[FM.TYPE]: "daily" satisfies ItemType,
		[FM.BOOK]: book,
		[FM.DATE]: date,
		[FM.WORDS]: 0,
		[FM.MINUTES]: 0,
		[FM.SESSIONS]: 0,
		[FM.GOAL]: settings.dailyGoal,
	});

	return file;
}

function characterTemplate(name: string, role: string): string {
	return `# ${name}\n\n**Rol:** ${role}\n\n## En una línea\n\n## Apariencia\n\n## Voz y forma de hablar\n\n## Quiere / necesita\n\n## Miedo o herida\n\n## Mentira que se cree\n\n## Arco\n\n## Escenas clave\n\n## Notas\n`;
}

const CHAPTER_TEMPLATE = `## Resumen del capítulo\n\n## Entrada\n\n## Salida\n\n## Objetivo del capítulo\n\n## Escenas\n`;

const INDEX_TEMPLATE = `# Manuscrito\n\n## Escenas\n`;
