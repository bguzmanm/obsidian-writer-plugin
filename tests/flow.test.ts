/**
 * Vault de mentira para probar el flujo completo: crear un capítulo o una
 * escena y comprobar que el repositorio lo ve enseguida.
 *
 * La clave está en `getFrontMatter`: devuelve SIEMPRE {} mientras el archivo
 * acaba de crearse, que es lo que hace Obsidian durante la ventana en la que
 * la caché de metadatos va por detrás. Si el plugin leyera de ahí, el capítulo
 * no aparecería en el panel hasta recargar el vault a mano.
 */

import { BookRepository } from "../src/vault/repository";
import { createBook, createChapter, createScene, readChapters, addChapterRef, createCharacter, updateSceneHeader } from "../src/vault/structure";
import { writeFrontMatter } from "../src/vault/schema";
import { FM } from "../src/types";
import { TFile, TFolder, normalizePath } from "./obsidian-stub";
import { countWords } from "../src/stats/count";

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

function section(name: string): void {
	console.log(`\n${name}`);
}

// ------------------------------------------------------------------ vault

interface Entry {
	path: string;
	content: string;
}

/**
 * Carpeta de mentira que instanceof TFolder, que es lo que comprueba
 * ensureFolder al crear la estructura del libro.
 */
class FakeFolder extends TFolder {
	path: string;
	name: string;
	children: unknown[];

	constructor(path: string) {
		super();
		this.path = path;
		const parts = path.split("/");
		this.name = parts[parts.length - 1] ?? path;
		this.children = [];
	}
}

/** Nota de mentira que instanceof TFile y con el frontmatter sin cachear. */
class FakeFile extends TFile {
	path: string;
	basename: string;
	stat: { mtime: number };
	parent?: { path: string };
	content: string;

	constructor(path: string, content: string, mtime: number, parent?: { path: string }) {
		super();
		this.path = path;
		const parts = path.split("/");
		this.basename = (parts[parts.length - 1] ?? "").replace(/\.md$/, "");
		this.stat = { mtime };
		this.content = content;
		this.parent = parent;
	}

	/** Obsidian todavía no ha cacheado el frontmatter de este archivo. */
	getFrontMatter(): Record<string, unknown> {
		return {};
	}
}

class FakeVault {
	files = new Map<string, FakeFile>();
	folders = new Map<string, FakeFolder>();
	mtime = 1;

	private remember(folderPath: string, child: unknown): void {
		const parts = folderPath.split("/");
		const parent = this.folders.get(parts.slice(0, -1).join("/"));
		if (parent) parent.children.push(child);
	}

	async createFolder(path: string): Promise<void> {
		const p = normalizePath(path);
		if (this.folders.has(p)) return;
		const folder = new FakeFolder(p);
		this.folders.set(p, folder);
		this.remember(p, folder);
	}

	async create(path: string, content: string): Promise<TFile> {
		const p = normalizePath(path);
		this.mtime += 1;
		const parts = p.split("/");
		const parent = this.folders.get(parts.slice(0, -1).join("/"));
		const file = new FakeFile(p, content, this.mtime, parent);
		this.files.set(p, file);
		this.remember(p, file);
		return file;
	}

	getAbstractFileByPath(path: string): unknown {
		const p = normalizePath(path);
		return this.files.get(p) ?? this.folders.get(p) ?? null;
	}

	getMarkdownFiles(): TFile[] {
		return [...this.files.values()];
	}

	async read(file: TFile): Promise<string> {
		const entry = this.files.get(file.path);
		if (!entry) throw new Error(`No existe ${file.path}`);
		return entry.content;
	}

	async modify(file: TFile, content: string): Promise<void> {
		const entry = this.files.get(file.path);
		if (!entry) return;
		entry.content = content;
		this.mtime += 1;
	}

	async process(file: TFile, fn: (source: string) => string): Promise<void> {
		const entry = this.files.get(file.path);
		if (!entry) return;
		const updated = fn(entry.content);
		if (updated !== entry.content) {
			entry.content = updated;
			this.mtime += 1;
		}
	}

	async append(file: TFile, content: string): Promise<void> {
		const entry = this.files.get(file.path);
		if (!entry) return;
		entry.content += content;
		this.mtime += 1;
	}
}

/** processFrontMatter reescribe el bloque --- ... --- del archivo. */
function makeApp(vault: FakeVault): never {
	return {
		vault,
		fileManager: {
			async processFrontMatter(file: TFile, fn: (front: Record<string, unknown>) => void) {
				const entry = vault.files.get(file.path);
				if (!entry) return;
				const current = entry.content;
				const match = current.match(/^---\n([\s\S]*?)\n---/);
				const front: Record<string, unknown> = {};
				if (match) {
					for (const line of match[1].split("\n")) {
						const kv = /^([\w-]+):\s*(.*)$/.exec(line);
						if (kv) front[kv[1]] = kv[2] === "" ? null : kv[2];
					}
				}
				fn(front);
				const rendered = Object.entries(front)
					.filter(([, v]) => v !== undefined && v !== null)
					.map(([k, v]) => `${k}: ${formatYaml(v)}`)
					.join("\n");
				entry.content = `---\n${rendered}\n---${current.slice(match?.[0].length ?? 0)}`;
				vault.mtime += 1;
			},
		},
	} as never;
}

function formatYaml(v: unknown): string {
	if (Array.isArray(v)) {
		if (v.length === 0) return "[]";
		if (typeof v[0] === "object") {
			const entries = v as Record<string, unknown>[];
			return (
				"\n" +
				entries
					.map((e, i) =>
						Object.entries(e)
							.map(([k, val], j) => `${j === 0 ? `  - ${k}` : `    ${k}`}: ${String(val)}`)
							.join("\n")
					)
					.join("\n")
			);
		}
		return `\n${v.map((x) => `  - ${String(x)}`).join("\n")}`;
	}
	return String(v);
}

const settings = {
	booksFolder: "Libros",
	dailyGoal: 500,
	weeklyGoal: 3500,
	bookGoal: 80000,
	countHeadings: false,
	books: ["Mi Libro"],
	currentBook: "Mi Libro",
	autoDetectBook: true,
} as never;

const BOOK = "Mi Libro";

// ------------------------------------------------- crear un capítulo nuevo

section("crear un capítulo y verlo sin esperar a la caché");

const vault = new FakeVault();
const app = makeApp(vault);
const repo = new BookRepository(app, settings);

const book0 = await createBook(app, settings, BOOK);
check("el libro crea su nota raíz", vault.getAbstractFileByPath(`${book0.root}/${BOOK}.md`) !== null, true);
check("y el índice del manuscrito", vault.getAbstractFileByPath(`${book0.root}/Manuscrito/Manuscrito.md`) !== null, true);

const created = await createChapter(app, settings, BOOK, "El despertar");
check("se crea la carpeta del capítulo", vault.getAbstractFileByPath(`${created.folder}`) !== null, true);
check("y su escena inicial", created.firstScene !== null, true);

check("readChapters ve el capítulo recién creado", (await readChapters(app, settings, BOOK)).map((c) => c.title), [
	"El despertar",
]);

const afterChapter = await repo.buildManuscript(BOOK);
check("el manuscrito ve el capítulo", afterChapter.chapters.map((c) => c.title), ["El despertar"]);
check("y ve su escena", afterChapter.chapters[0].scenes.map((s) => s.title), ["Escena 1"]);
check("con su capítulo asignado", afterChapter.scenes[0].chapter, "El despertar");

// el título sale del cuerpo, nunca del "---" del frontmatter
check("el título de la escena no es el frontmatter", afterChapter.scenes[0].title !== "---", true);
check("ni el guion de apertura", afterChapter.scenes[0].title, "Escena 1");

// -------------------------------------------------- crear una escena nueva

section("crear una escena y verla sin esperar a la caché");

const sceneFile = await createScene(app, settings, BOOK, {
	title: "El mercado",
	chapterTitle: "El despertar",
});

check("el archivo de la escena existe", vault.getAbstractFileByPath(sceneFile.path) !== null, true);
check("readChapters sigue teniendo un solo capítulo", (await readChapters(app, settings, BOOK)).length, 1);

const afterScene = await repo.buildManuscript(BOOK);
check("el manuscrito ve las dos escenas", afterScene.scenes.map((s) => s.title), ["Escena 1", "El mercado"]);
check("y las agrupa en su capítulo", afterScene.chapters[0].scenes.length, 2);
check("en el orden correcto", afterScene.chapters[0].scenes.map((s) => s.order), [1, 2]);

// ----------------------------------------------------- añadir más capítulos

section("varios capítulos seguidos");

await createChapter(app, settings, BOOK, "La traición");
await createChapter(app, settings, BOOK, "El final");

const all = await readChapters(app, settings, BOOK);
check("se acumulan los tres capítulos", all.map((c) => c.title), ["El despertar", "La traición", "El final"]);
check("con órdenes correlativos", all.map((c) => c.order), [1, 2, 3]);

const allChapters = (await repo.buildManuscript(BOOK)).chapters;
check("el manuscrito los ordena", allChapters.map((c) => c.title), ["El despertar", "La traición", "El final"]);

// sin escenas, un capítulo nuevo tampoco debe romperse
check("el último capítulo tiene su escena inicial", allChapters[2].scenes.length, 1);

// --------------------------------------------------- palabras y notas nuevas

section("contenido y palabras");

// el encabezado no cuenta, y las palabras van separadas por espacios
const words = countWords("# El mercado\n\nUn canceling sprawled tilts again. None slip. Reeling.");
check("el conteo ignora el encabezado y cuenta el cuerpo", words.words, 8);

const m2 = await repo.buildManuscript(BOOK);
check("el manuscrito suma todas las escenas", m2.scenes.length, 4);

// -------------------------------------------------- las listas no se pierden

section("el índice no pierde capítulos al añadir otro");

// addChapterRef relee el índice del disco: si usara la caché ([] todavía),
// añadiría el capítulo y borraría los anteriores.
await addChapterRef(app, settings, BOOK, { title: "Epílogo", folderName: "04 - Epílogo", order: 4 });
const afterRef = await readChapters(app, settings, BOOK);
check("los cuatro capítulos siguen en el índice", afterRef.map((c) => c.title), [
	"El despertar",
	"La traición",
	"El final",
	"Epílogo",
]);

// ------------------------------------------------------ libro legacy sin índice

section("libro creado antes del índice (solo carpetas)");

// Un libro antiguo puede tener la carpeta Manuscrito/ con capítulos pero sin
// la nota índice Manuscrito.md. Ese caso antes fallaba: readChapters devolvía
// [] y «+ Capítulo» terminaba en "Crea un capítulo antes de añadir escenas".
async function legacyVault(): Promise<{ vault: FakeVault; app: never }> {
	const v = new FakeVault();
	const p = (s: string) => normalizePath(`Libros/Legado/${s}`);
	await v.createFolder(p("Manuscrito"));
	await v.createFolder(p("Manuscrito/01 - Antiguo"));
	await v.createFolder(p("Manuscrito/02 - Segundo"));
	await v.create(p("Manuscrito/01 - Antiguo/Antiguo.md"), "# Antiguo\n");
	await v.create(p("Manuscrito/02 - Segundo/Segundo.md"), "# Segundo\n");
	const a = makeApp(v);
	return { vault: v, app: a };
}

{
	const { vault, app: legacyApp } = await legacyVault();

	const legacyChapters = await readChapters(legacyApp, settings, "Legado");
	check("ve los capítulos de las carpetas sin índice", legacyChapters.map((c) => c.title), [
		"Antiguo",
		"Segundo",
	]);
	check("con su orden y carpeta", legacyChapters.map((c) => c.order), [1, 2]);

	// un capítulo nuevo sobre un libro legacy debe crear el índice y encolar
	// después de los que ya están
	const made = await createChapter(legacyApp, settings, "Legado", "Nuevo");
	check("crea su escena inicial", made.firstScene !== null, true);
	check("la carpeta lleva el siguiente número", made.folder.endsWith("03 - Nuevo"), true);

	const indexFile = vault.getAbstractFileByPath("Libros/Legado/Manuscrito/Manuscrito.md");
	check("crea la nota índice", indexFile !== null, true);

	const all = await readChapters(legacyApp, settings, "Legado");
	check("junta los heredados con el nuevo", all.map((c) => c.title), ["Antiguo", "Segundo", "Nuevo"]);
	check("con órdenes correlativos", all.map((c) => c.order), [1, 2, 3]);
}

// ------------------------------------------- personajes marcados por escena

section("marcar personajes en una escena");

const anaFile = await createCharacter(app, settings, BOOK, "Ana");
const scenesBefore = await repo.getScenes(BOOK);
const firstScene = scenesBefore[0];
check("los personajes parten vacíos", firstScene.characters, []);
check("ni el capítulo tiene personajes", (await repo.buildManuscript(BOOK)).chapters[0].characters, []);

const firstSceneFile = vault.getAbstractFileByPath(firstScene.path) as FakeFile;
await writeFrontMatter(app, firstSceneFile, { [FM.CHARACTERS]: ["Ana"] });

const midScenes = await repo.getScenes(BOOK);
check("getScenes lee el personaje marcado", midScenes[0].characters, ["Ana"]);

const midManuscript = await repo.buildManuscript(BOOK);
check("el capítulo agrega a Ana", midManuscript.chapters[0].characters, ["Ana"]);

const withChars = await repo.getCharacters(BOOK, midScenes);
const ana = withChars.find((c) => c.name === "Ana");
check("Ana aparece en la escena marcada", ana !== undefined && ana.appearsIn.includes(firstScene.path), true);
void anaFile;

// ----------------------------------------------- cabecera de la escena viva

section("la cabecera de la escena sigue al frontmatter");

let sceneSource = await vault.read(firstSceneFile);
check("la escena nueva trae su cabecera", /POV:\*\* —/.test(sceneSource), true);

await writeFrontMatter(app, firstSceneFile, { [FM.POV]: "Ana", [FM.STATUS]: "revision" });
await updateSceneHeader(app, settings, firstSceneFile);
sceneSource = await vault.read(firstSceneFile);
check("la cabecera refleja el POV nuevo", /POV:\*\* Ana/.test(sceneSource), true);
check("y el estado nuevo", /Estado:\*\* revision/.test(sceneSource), true);

await vault.modify(
	firstSceneFile,
	"---\nbw_type: scene\n---\n# A\n\n> **POV:** —   **Estado:** draft   **Palabras:** 0\n\nPalabras de prueba aquí.\n"
);
await updateSceneHeader(app, settings, firstSceneFile);
sceneSource = await vault.read(firstSceneFile);
check("cuenta las palabras reales", /Palabras:\*\* 4/.test(sceneSource), true);

// -------------------------------------------------------------- resumen

console.log(`\n${"=".repeat(50)}`);
console.log(`${pass} correctas, ${fail} fallidas`);
process.exit(fail === 0 ? 0 : 1);
