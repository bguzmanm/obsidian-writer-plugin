import { App, TFile, TFolder } from "obsidian";
import { WriterSettings } from "../settings";
import { countWords, firstMeaningfulLine } from "../stats/count";
import { computeStreaks, startOfWeek, todayKey } from "../stats/dates";
import {
	BookRef,
	Chapter,
	Character,
	CharacterRole,
	DayStat,
	FM,
	Manuscript,
	Scene,
	SceneStatus,
	STATUS_ORDER,
	WorldEntry,
} from "../types";
import { bodyOf, fmNumber, fmString, fmStringList, isType, noteView, writeFrontMatter } from "./schema";
import { bookRoot, readChapters } from "./structure";

interface CountCacheEntry {
	words: number;
	chars: number;
	mtime: number;
}

const ZERO_STATUS = (): Record<SceneStatus, number> => ({
	idea: 0,
	outline: 0,
	draft: 0,
	revision: 0,
	done: 0,
});

/**
 * Capa de lectura del vault. Todas las estadísticas salen de las notas:
 * no hay estado escondido, así que el vault sigue siendo la fuente de verdad.
 */
export class BookRepository {
	app: App;
	settings: WriterSettings;
	private counts = new Map<string, CountCacheEntry>();

	constructor(app: App, settings: WriterSettings) {
		this.app = app;
		this.settings = settings;
	}

	invalidate(): void {
		this.counts.clear();
	}

	// ---------------------------------------------------------------- libros

	listBooks(): BookRef[] {
		const books: BookRef[] = [];
		const folder = this.settings.booksFolder;
		const base = folder === "" ? null : this.app.vault.getAbstractFileByPath(folder);

		if (base instanceof TFolder) {
			for (const child of base.children) {
				if (!(child instanceof TFolder)) continue;
				books.push({ name: child.name, root: child.path });
			}
		}

		// libros declarados con bw_type: book aunque vivan fuera de la carpeta
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!isType(file, "book")) continue;
			const name = fmString(file, FM.BOOK) || fmString(file, FM.NAME);
			if (!name) continue;
			if (books.some((b) => b.name === name)) continue;
			books.push({ name, root: file.parent?.path ?? "" });
		}

		return books.sort((a, b) => a.name.localeCompare(b.name, "es"));
	}

	/** Descubre el libro al que pertenece una nota cualquiera. */
	bookOfFile(file: TFile): string {
		const declared = fmString(file, FM.BOOK);
		if (declared) return declared;

		// si no está declarado, busca el libro más cercano por ruta
		let best = "";
		let bestLen = -1;
		for (const book of this.listBooks()) {
			if (!book.root) continue;
			if (file.path.startsWith(book.root + "/") && book.root.length > bestLen) {
				best = book.name;
				bestLen = book.root.length;
			}
		}
		return best;
	}

	// ------------------------------------------------------------- conteos

	async countFile(file: TFile): Promise<{ words: number; chars: number }> {
		const cached = this.counts.get(file.path);
		if (cached && cached.mtime === file.stat.mtime) {
			return { words: cached.words, chars: cached.chars };
		}

		const source = await this.app.vault.read(file);
		const body = bodyOf(source);
		const result = countWords(body, { countHeadings: this.settings.countHeadings });

		this.counts.set(file.path, { words: result.words, chars: result.chars, mtime: file.stat.mtime });
		return { words: result.words, chars: result.chars };
	}

	// ------------------------------------------------------------- escenas

	async getScenes(book: string): Promise<Scene[]> {
		const candidates = await this.markdownWith(async (file) => {
			const source = await this.app.vault.read(file);
			return isType(noteView(file, source), "scene") && this.belongsTo(noteView(file, source), book)
				? file
				: null;
		});

		const scenes: Scene[] = [];
		for (const file of candidates) {
			const source = await this.app.vault.read(file);
			const body = bodyOf(source);
			const view = noteView(file, source);
			const { words, chars } = await this.countFile(file);
			const status = (fmString(view, FM.STATUS, "draft") as SceneStatus) || "draft";

			scenes.push({
				path: file.path,
				book,
				chapter: fmString(view, FM.CHAPTER, "Sin capítulo"),
				title: firstMeaningfulLine(body) || file.basename,
				order: fmNumber(view, FM.ORDER, 0),
				status: STATUS_ORDER.includes(status) ? status : "draft",
				pov: fmString(view, FM.POV),
				characters: fmStringList(view, FM.CHARACTERS),
				words,
				chars,
				synopsis: this.extractSection(body, "Sinopsis"),
			});
		}

		return scenes.sort((a, b) => {
			const byChapter = a.chapter.localeCompare(b.chapter, "es", { numeric: true });
			if (byChapter !== 0) return byChapter;
			return a.order - b.order;
		});
	}

	/**
	 * Filtra las notas markdown del libro leyendo su frontmatter del texto.
	 *
	 * `getMarkdownFiles()` + `isType()` sobre la caché de metadatos no sirve
	 * aquí: al crear una nota, el archivo ya está en el vault pero su
	 * frontmatter aún no está cacheado, y el panel se dibuja enseguida.
	 */
	private async markdownWith<T extends TFile>(
		pick: (file: TFile) => Promise<T | null>
	): Promise<T[]> {
		const out: T[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const hit = await pick(file as T);
			if (hit) out.push(hit);
		}
		return out;
	}

	private belongsTo(file: TFile, book: string): boolean {
		const declared = fmString(file, FM.BOOK);
		if (declared) return declared === book;
		if (!book) return true;
		const root = bookRoot(this.settings, book);
		return file.path.startsWith(root + "/");
	}

	// ----------------------------------------------------------- capítulos

	async getChapters(book: string, scenes: Scene[]): Promise<Chapter[]> {
		const refs = await readChapters(this.app, this.settings, book);
		const byTitle = new Map<string, Scene[]>();
		for (const scene of scenes) {
			const list = byTitle.get(scene.chapter) ?? [];
			list.push(scene);
			byTitle.set(scene.chapter, list);
		}

		const chapters: Chapter[] = refs.map((ref) => {
			const list = byTitle.get(ref.title) ?? [];
			return {
				path: bookRoot(this.settings, book) + "/" + ref.folderName,
				book,
				title: ref.title,
				order: ref.order,
				scenes: list,
				characters: chapterCharacters(list),
				words: list.reduce((sum, s) => sum + s.words, 0),
			};
		});

		// escenas cuyo capítulo no está en el índice
		for (const [title, list] of byTitle) {
			if (chapters.some((c) => c.title === title)) continue;
			chapters.push({
				path: list[0]?.path ?? "",
				book,
				title,
				order: 9999,
				scenes: list,
				characters: chapterCharacters(list),
				words: list.reduce((sum, s) => sum + s.words, 0),
			});
		}

		return chapters.sort((a, b) => a.order - b.order);
	}

	// --------------------------------------------------------- personajes

	async getCharacters(book: string, scenes: Scene[]): Promise<Character[]> {
		const files = await this.markdownWith(async (file) => {
			const source = await this.app.vault.read(file);
			const view = noteView(file, source);
			return isType(view, "character") && this.belongsTo(view, book) ? file : null;
		});

		const characters: Character[] = [];
		const known = new Set<string>();

		for (const file of files) {
			const source = await this.app.vault.read(file);
			const body = bodyOf(source);
			const view = noteView(file, source);
			const name = fmString(view, FM.NAME) || firstMeaningfulLine(body) || file.basename;
			const role = (fmString(view, FM.ROLE, "secondary") as CharacterRole) || "secondary";
			known.add(name.toLowerCase());

			// apariciones: escenas donde es POV o está marcado en bw_characters
			const appearsIn = scenes
				.filter((s) => {
					const asPov = s.pov.toLowerCase() === name.toLowerCase();
					const listed = s.characters.some((c) => c.toLowerCase() === name.toLowerCase());
					return asPov || listed;
				})
				.map((s) => s.path)
				.filter((path, i, arr) => arr.indexOf(path) === i);

			characters.push({
				path: file.path,
				book,
				name,
				role: ["protagonist", "antagonist", "secondary", "minor"].includes(role)
					? role
					: "secondary",
				status: fmString(view, FM.STATUS, "activo"),
				summary: this.extractSection(body, "En una línea") || firstMeaningfulLine(body, 160),
				appearsIn,
			});
		}

		// un POV usado en escenas pero sin ficha todavía
		for (const scene of scenes) {
			if (!scene.pov) continue;
			if (known.has(scene.pov.toLowerCase())) continue;
			known.add(scene.pov.toLowerCase());
			characters.push({
				path: "",
				book,
				name: scene.pov,
				role: "secondary",
				status: "sin ficha",
				summary: "",
				appearsIn: scenes
					.filter((s) => s.pov === scene.pov || s.characters.includes(scene.pov))
					.map((s) => s.path),
			});
		}

		return characters.sort((a, b) => {
			const rank: Record<CharacterRole, number> = {
				protagonist: 0,
				antagonist: 1,
				secondary: 2,
				minor: 3,
			};
			if (rank[a.role] !== rank[b.role]) return rank[a.role] - rank[b.role];
			return a.name.localeCompare(b.name, "es");
		});
	}

	// ------------------------------------------------------------- mundo

	async getWorldEntries(book: string): Promise<WorldEntry[]> {
		const files = await this.markdownWith(async (file) => {
			const source = await this.app.vault.read(file);
			const view = noteView(file, source);
			return isType(view, "world") && this.belongsTo(view, book) ? file : null;
		});

		const entries: WorldEntry[] = [];
		for (const file of files) {
			const source = await this.app.vault.read(file);
			const body = bodyOf(source);
			const view = noteView(file, source);
			entries.push({
				path: file.path,
				book,
				name: fmString(view, FM.NAME) || firstMeaningfulLine(body) || file.basename,
				kind: fmString(view, FM.KIND, "Elemento"),
				summary: this.extractSection(body, "Descripción"),
			});
		}
		return entries.sort((a, b) => a.name.localeCompare(b.name, "es"));
	}

	// ---------------------------------------------------------- registro

	/** Serie diaria de palabras y minutos, ordenada ascendentemente. */
	async getDailyStats(book: string): Promise<DayStat[]> {
		const files = await this.markdownWith(async (file) => {
			const source = await this.app.vault.read(file);
			const view = noteView(file, source);
			return isType(view, "daily") && this.belongsTo(view, book) ? file : null;
		});

		const stats: DayStat[] = [];
		for (const file of files) {
			const view = noteView(file, await this.app.vault.read(file));
			stats.push({
				date: fmString(view, FM.DATE) || file.basename.slice(0, 10),
				words: fmNumber(view, FM.WORDS, 0),
				minutes: fmNumber(view, FM.MINUTES, 0),
			});
		}
		return stats.sort((a, b) => a.date.localeCompare(b.date));
	}

	// ------------------------------------------------------ manuscrito

	async buildManuscript(book: string): Promise<Manuscript> {
		const scenes = await this.getScenes(book);
		const chapters = await this.getChapters(book, scenes);
		const daily = await this.getDailyStats(book);

		const words = scenes.reduce((sum, s) => sum + s.words, 0);
		const byStatus = ZERO_STATUS();
		for (const scene of scenes) byStatus[scene.status] += 1;

		const today = todayKey();
		const weekStart = startOfWeek(new Date());

		let todayWords = 0;
		let weekWords = 0;
		for (const day of daily) {
			if (day.date === today) todayWords = day.words;
			if (day.date >= weekStart) weekWords += day.words;
		}
		const { streak, bestStreak } = computeStreaks(daily);

		return {
			book,
			words,
			characters: await this.countCharacters(book),
			wordsPerScene: scenes.length > 0 ? Math.round(words / scenes.length) : 0,
			scenes,
			byStatus,
			chapters,
			daily,
			streak,
			bestStreak,
			today: todayWords,
			week: weekWords,
			weekGoal: this.settings.weeklyGoal,
			todayGoal: this.settings.dailyGoal,
		};
	}

	async countCharacters(book: string): Promise<number> {
		return (await this.markdownWith(async (file) => {
			const source = await this.app.vault.read(file);
			const view = noteView(file, source);
			return isType(view, "character") && this.belongsTo(view, book) ? file : null;
		})).length;
	}

	// ------------------------------------------------------------- util

	/** Devuelve el texto que sigue a un encabezado "## X". */
	extractSection(body: string, heading: string): string {
		const re = new RegExp(`^#{2,6}\\s*${escapeRe(heading)}\\s*$`, "im");
		const match = re.exec(body);
		if (!match) return "";
		const rest = body.slice(match.index + match[0].length);
		const next = /^\s*#{1,6}\s+/m.exec(rest);
		const section = next ? rest.slice(0, next.index) : rest;
		return section.replace(/^>\s?/gm, "").trim();
	}

	/** Guarda en el frontmatter el recuento de palabras de una escena. */
	async syncSceneCounts(file: TFile): Promise<number> {
		if (!isType(file, "scene")) return 0;
		const { words } = await this.countFile(file);
		await writeFrontMatter(this.app, file, { [FM.WORDS]: words });
		return words;
	}
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Personajes (POV + bw_characters) de un grupo de escenas, sin repetir. */
function chapterCharacters(scenes: Scene[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const scene of scenes) {
		if (scene.pov) {
			const k = scene.pov.toLowerCase();
			if (!seen.has(k)) {
				seen.add(k);
				out.push(scene.pov);
			}
		}
		for (const name of scene.characters) {
			const k = name.toLowerCase();
			if (!seen.has(k)) {
				seen.add(k);
				out.push(name);
			}
		}
	}
	return out;
}
