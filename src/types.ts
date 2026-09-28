export const VIEW_TYPE_WRITER = "writer-sidebar";

/** Prefijo de todas las claves de frontmatter que usa el plugin. */
export const FM = {
	TYPE: "bw_type",
	BOOK: "bw_book",
	ORDER: "bw_order",
	STATUS: "bw_status",
	POV: "bw_pov",
	ROLE: "bw_role",
	NAME: "bw_name",
	DATE: "bw_date",
	WORDS: "bw_words",
	MINUTES: "bw_minutes",
	SESSIONS: "bw_sessions",
	START: "bw_start",
	END: "bw_end",
	GOAL: "bw_goal",
	ESTIMATE: "bw_estimate",
	CHAPTER: "bw_chapter",
	CHAPTERS: "bw_chapters",
	APPEARS: "bw_appears",
	KIND: "bw_kind",
} as const;

export type ItemType = "book" | "chapter" | "scene" | "character" | "world" | "daily";

export type SceneStatus = "idea" | "outline" | "draft" | "revision" | "done";

export type CharacterRole = "protagonist" | "antagonist" | "secondary" | "minor";

export interface Scene {
	/** Ruta completa dentro del vault. */
	path: string;
	book: string;
	chapter: string;
	title: string;
	order: number;
	status: SceneStatus;
	pov: string;
	words: number;
	chars: number;
	synopsis: string;
}

export interface Chapter {
	/** Carpeta del capítulo, o ruta de la nota si el capítulo es una sola nota. */
	path: string;
	book: string;
	title: string;
	order: number;
	scenes: Scene[];
	words: number;
}

export interface Character {
	path: string;
	book: string;
	name: string;
	role: CharacterRole;
	/** Ruta de la nota donde vive la ficha, o "" si es una ficha suelta. */
	status: string;
	summary: string;
	/** Nombres o rutas de notas donde aparece el personaje. */
	appearsIn: string[];
}

export interface WorldEntry {
	path: string;
	book: string;
	name: string;
	kind: string;
	summary: string;
}

export interface BookRef {
	/** Nombre del libro, tal como aparece en el frontmatter. */
	name: string;
	/** Carpeta raíz del libro dentro del vault. */
	root: string;
}

/** Un capítulo, tal y como se guarda en el frontmatter del índice. */
export interface ChapterRef {
	title: string;
	folderName: string;
	order: number;
}

export interface DayStat {
	date: string;
	words: number;
	minutes: number;
}

export interface Manuscript {
	book: string;
	words: number;
	characters: number;
	wordsPerScene: number;
	scenes: Scene[];
	byStatus: Record<SceneStatus, number>;
	chapters: Chapter[];
	daily: DayStat[];
	streak: number;
	bestStreak: number;
	today: number;
	week: number;
	weekGoal: number;
	todayGoal: number;
}

export const STATUS_LABELS: Record<SceneStatus, string> = {
	idea: "Idea",
	outline: "Esquema",
	draft: "Borrador",
	revision: "Revisión",
	done: "Terminado",
};

export const STATUS_ORDER: SceneStatus[] = ["idea", "outline", "draft", "revision", "done"];

export const ROLE_LABELS: Record<CharacterRole, string> = {
	protagonist: "Protagonista",
	antagonist: "Antagonista",
	secondary: "Secundario",
	minor: "Menor",
};
