import { App, Notice, TFile } from "obsidian";
import { WriterSettings } from "../settings";
import { FM } from "../types";
import { BookRepository } from "../vault/repository";
import { writeFrontMatter } from "../vault/schema";
import { todayKey } from "./dates";
import { getOrCreateDailyLog } from "../vault/structure";

/** Una sesión de escritura: un intervalo de trabajo con un recuento de palabras. */
export interface Session {
	/** Epoch ms de inicio. */
	start: number;
	/** Epoch ms de fin. */
	end: number;
	minutes: number;
	words: number;
	notePath: string;
}

interface ActiveSession {
	start: number;
	notePath: string;
	noteTitle: string;
	wordsAtStart: number;
	charsAtStart: number;
	timer: number;
}

/**
 * Mide el tiempo de escritura y lo contrasta con el recuento de palabras de la
 * nota, para distinguir escribir de reescribir. El objetivo no es vigilar, es
 * dar un número honesto al final del día.
 */
export class SessionTracker {
	app: App;
	settings: WriterSettings;
	repo: BookRepository;
	active: ActiveSession | null = null;
	/** Se llama con el delta de palabras al terminar. */
	onSessionEnd: ((session: Session) => void) | null = null;

	constructor(app: App, settings: WriterSettings, repo: BookRepository) {
		this.app = app;
		this.settings = settings;
		this.repo = repo;
	}

	get isRunning(): boolean {
		return this.active !== null;
	}

	get elapsedMinutes(): number {
		if (!this.active) return 0;
		return Math.max(1, Math.round((Date.now() - this.active.start) / 60000));
	}

	/** Llamado en el editor para iniciar un conteo. */
	async start(file: TFile | null): Promise<void> {
		if (this.active) {
			new Notice("Ya hay una sesión de escritura en curso.");
			return;
		}

		const note = file;
		if (!note) {
			new Notice("Abre una nota de escena para empezar a escribir.");
			return;
		}

		const count = await this.repo.countFile(note);
		this.active = {
			start: Date.now(),
			notePath: note.path,
			noteTitle: note.basename,
			wordsAtStart: count.words,
			charsAtStart: count.chars,
			timer: 0,
		};
	}

	/** Detiene la sesión, calcula el delta y lo guarda en la nota del día. */
	async stop(book: string): Promise<Session | null> {
		if (!this.active) {
			new Notice("No hay ninguna sesión en curso.");
			return null;
		}

		const active = this.active;
		this.active = null;
		window.clearInterval(active.timer);

		const file = this.app.vault.getAbstractFileByPath(active.notePath);
		let words = 0;
		let chars = 0;
		if (file instanceof TFile) {			const count = await this.repo.countFile(file);
			words = count.words;
			chars = count.chars;
		}

		const addedWords = Math.max(0, words - active.wordsAtStart);
		const addedChars = Math.max(0, chars - active.charsAtStart);
		const minutes = Math.max(0, Math.round((Date.now() - active.start) / 60000));

		const session: Session = {
			start: active.start,
			end: Date.now(),
			minutes,
			words: addedWords,
			notePath: active.notePath,
		};

		if (addedChars < 5 && minutes < 1) {
			new Notice("Sesión descartada: no hay cambios ni tiempo suficiente.");
			return null;
		}

		await this.record(book, session, addedChars);
		this.onSessionEnd?.(session);
		return session;
	}

	/**
	 * Suma la sesión al registro del día y actualiza el frontmatter.
	 *
	 * Los totales se sacan de las filas de la tabla, no del frontmatter, porque
	 * la caché de metadatos de Obsidian puede ir un cambio por detrás justo
	 * después de escribir. El frontmatter se actualiza igualmente, pero es una
	 * caché de lectura rápida, no la cuenta buena.
	 */
	async record(book: string, session: Session, addedChars: number): Promise<void> {
		if (!book) return;

		const date = todayKey();
		const log = await getOrCreateDailyLog(this.app, this.settings, book, date);
		const source = await this.app.vault.read(log);

		const row = `| ${time(session.start)} | ${time(session.end)} | ${session.minutes} | ${session.words} | +${addedChars} car. |`;
		const totals = sumRows(source);

		const words = totals.words + session.words;
		const minutes = totals.minutes + session.minutes;
		const sessions = totals.sessions + 1;

		const updated = source.includes(TABLE_HEADER)
			? source.replace(TABLE_HEADER, `${TABLE_HEADER}\n${row}`)
			: `${source.trimEnd()}\n\n${TABLE_HEADER}\n${row}\n`;

		await this.app.vault.modify(log, updated);
		await writeFrontMatter(this.app, log, {
			[FM.WORDS]: words,
			[FM.MINUTES]: minutes,
			[FM.SESSIONS]: sessions,
			[FM.DATE]: date,
		});

		const goal = this.settings.dailyGoal;
		if (goal > 0) {
			const pct = Math.round((words / goal) * 100);
			new Notice(
				words >= goal
					? `Meta diaria cumplida: ${words} palabras (${session.minutes} min).`
					: `Sesión guardada: +${session.words} palabras. Vas ${pct}% de la meta diaria.`
			);
		} else {
			new Notice(`Sesión guardada: +${session.words} palabras en ${session.minutes} min.`);
		}
	}

	/**
	 * Reconcilia el registro con la realidad: si alguien escribió hoy pero no
	 * registró sesión, el panel puede detectar la diferencia.
	 */
	async wordsWrittenToday(scenes: { words: number }[]): Promise<number> {
		const total = scenes.reduce((sum, s) => sum + s.words, 0);
		return total;
	}
}

const TABLE_HEADER = "| --- | --- | --- | --- | --- |";

/** Una fila de sesión: | inicio | fin | minutos | palabras | notas | */
const SESSION_ROW = /^\|\s*\d{1,2}:\d{2}\s*\|\s*\d{1,2}:\d{2}\s*\|\s*[\d—-]+\s*\|\s*[\d—-]+\s*\|/;

function time(ms: number): string {
	return new Date(ms).toTimeString().slice(0, 5);
}

/** Suma minutos, palabras y cuenta de sesiones a partir de las filas ya escritas. */
export function sumRows(source: string): { words: number; minutes: number; sessions: number } {
	let words = 0;
	let minutes = 0;
	let sessions = 0;

	for (const line of source.split(/\r?\n/)) {
		// el patrón completo evita contar tablas de otras secciones
		if (!SESSION_ROW.test(line)) continue;
		const cells = line.split("|").map((c) => c.trim());
		minutes += Number(cells[3]) || 0;
		words += Number(cells[4]) || 0;
		sessions += 1;
	}

	return { words, minutes, sessions };
}
