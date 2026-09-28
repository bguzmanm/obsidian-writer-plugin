/**
 * Medición "en vivo" de las palabras de hoy y de la semana.
 *
 * Sesiones aparte, lo escrito hoy se mide contra una referencia del
 * manuscrito: el total que había al empezar hoy (y al empezar la semana).
 * El delta del manuscrito contra esa referencia es el número honesto,
 * porque no depende de recordar cerrar una sesión.
 */

export interface WordBaseline {
	/** Fecha (YYYY-MM-DD) a la que corresponde la referencia del día. */
	day: string;
	/** Total de palabras del manuscrito al inicio de ese día. */
	dayWords: number;
	/** Lunes (YYYY-MM-DD) de la semana a la que corresponde la referencia. */
	week: string;
	/** Total de palabras del manuscrito al inicio de esa semana. */
	weekWords: number;
}

export interface LiveResult {
	baseline: WordBaseline;
	/** Palabras escritas hoy: manuscrito actual menos la referencia del día. */
	today: number;
	/** Palabras escritas esta semana: menos la referencia de la semana. */
	week: number;
	/** Si hubo que fijar (o avanzar) alguna referencia. */
	changed: boolean;
}

/**
 * Actualiza la referencia y devuelve las palabras de hoy y de la semana.
 *
 * La referencia del día se fija la primera vez que se ve el manuscrito en
 * ese día; la de la semana, la primera vez que se ve en esa semana. Solo
 * cambia cuando cambia el día o la semana, así que es barata y persistible.
 */
export function advanceBaseline(
	prev: WordBaseline | undefined,
	words: number,
	today: string,
	weekStart: string
): LiveResult {
	const baseline: WordBaseline = prev ? { ...prev } : { day: "", dayWords: words, week: "", weekWords: words };
	let changed = false;

	if (baseline.day !== today) {
		baseline.day = today;
		baseline.dayWords = words;
		changed = true;
	}
	if (baseline.week !== weekStart) {
		baseline.week = weekStart;
		baseline.weekWords = words;
		changed = true;
	}

	return {
		baseline,
		today: Math.max(0, words - baseline.dayWords),
		week: Math.max(0, words - baseline.weekWords),
		changed,
	};
}