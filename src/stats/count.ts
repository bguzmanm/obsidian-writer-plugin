/**
 * Recuento de palabras que funciona con español, inglés y acentos.
 * Se apoya en Unicode property escapes, así que "corazón" y "Ángela"
 * cuentan como una palabra cada una, y los guiones no partzen palabras.
 */

// Una palabra es una secuencia de letras, números, apóstrofos internos y
// guiones internos. Los apóstrofos y guiones sólo valen en medio.
const WORD_RE = /[\p{L}\p{N}](?:[\p{L}\p{N}'’\-]*[\p{L}\p{N}])?/gu;

/** Elimina el markdown de una línea para que el recuento no cuente su sintaxis. */
function stripMarkdown(line: string): string {
	return line
		// bloques de código
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/~~~[\s\S]*?~~~/g, " ")
		// código en línea
		.replace(/`[^`]*`/g, " ")
		// imágenes y enlaces: ![alt](url) -> alt, [texto](url) -> texto
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		// referencias: [texto][ref] -> texto
		.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
		// etiquetas html
		.replace(/<[^>]+>/g, " ")
		// énfasis, citas, guiones de lista
		.replace(/^\s{0,3}([-*+]\s+|\d+[.)]\s+|>\s?)/, "");
}

export interface CountOptions {
	/** Incluir líneas de encabezado (# Título). */
	countHeadings: boolean;
	/** Contar números como palabras (por defecto no). */
	countNumbers?: boolean;
}

export interface CountResult {
	words: number;
	chars: number;
	/** Texto limpio, útil para sinopsis. */
	text: string;
}

export function countWords(source: string, options: CountOptions = { countHeadings: false }): CountResult {
	if (!source) return { words: 0, chars: 0, text: "" };

	const keep: string[] = [];
	let inFence = false;
	let fenceChar = "";

	for (const rawLine of source.split(/\r?\n/)) {
		// los bloques de código se saltan enteros, abran o cierren
		const fence = /^\s{0,3}(```+|~~~+)/.exec(rawLine);
		if (fence) {
			const char = fence[1][0];
			if (!inFence) {
				inFence = true;
				fenceChar = char;
			} else if (char === fenceChar) {
				inFence = false;
				fenceChar = "";
			}
			continue;
		}
		if (inFence) continue;

		const isHeading = /^\s{0,3}#{1,6}\s/.test(rawLine);
		const isTable = /^\s{0,3}\|/.test(rawLine);

		if (isHeading && !options.countHeadings) continue;
		if (isTable) continue;

		let line = stripMarkdown(rawLine);
		// las citas siguen siendo texto del autor
		line = line.replace(/^\s*>\s?/, "");
		keep.push(line);
	}

	const text = keep.join("\n");
	const words = countWordsInText(text, options);
	const chars = text.replace(/\s/g, "").length;

	return { words, chars, text };
}

export function countWordsInText(text: string, options: CountOptions = { countHeadings: false }): number {
	if (!text) return 0;
	WORD_RE.lastIndex = 0;
	let total = 0;
	let match: RegExpExecArray | null;

	while ((match = WORD_RE.exec(text)) !== null) {
		if (!options.countNumbers && /^[\p{N}\p{M}]+$/u.test(match[0])) continue;
		total += 1;
		// evita bucles infinitos con la flag global
		if (match.index === WORD_RE.lastIndex) WORD_RE.lastIndex += 1;
	}

	return total;
}

/** Estimación de minutos de escritura a partir de las palabras añadidas. */
export function estimateMinutes(words: number, wordsPerMinute = 250): number {
	if (words <= 0) return 0;
	return Math.max(1, Math.round(words / wordsPerMinute));
}

/** Primera línea no vacía de una nota, útil como título o sinopsis. */
export function firstMeaningfulLine(source: string, limit = 200): string {
	const lines = source.split(/\r?\n/);
	for (const line of lines) {
		const clean = line
			.replace(/^\s{0,3}#{1,6}\s+/, "")
			.replace(/^\s*>\s?/, "")
			.replace(/\*\*|__|\*|_|`/g, "")
			.trim();
		if (clean.length > 0) return clean.length > limit ? clean.slice(0, limit - 1) + "…" : clean;
	}
	return "";
}
