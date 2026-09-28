/**
 * Sustituto mínimo del módulo "obsidian" para poder probar el código que no
 * depende de Obsidian en tiempo de ejecución. Sólo cubre lo que usan los
 * módulos que probamos: types, dates, schema y dom.
 */
export function normalizePath(path) {
	return path
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\/+|\/+$/g, "");
}

export class TFile {}
export class TFolder {}
export class TAbstractFile {}

export class Notice {
	constructor(message) {
		// eslint-disable-next-line no-console
		console.log(`  [Notice] ${message}`);
	}
}
