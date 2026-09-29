import type WriterPlugin from "../main";

const DASH_PREFIX = /^[—-]\s*/;

/**
 * Render de bloques de diálogo:
 *
 *     ```dialogue
 *     ¡Hola! —dijo Ana.
 *     - ¿Vienes? —preguntó Marcos.
 *     ```
 *
 * Cada línea se pinta con su raya de diálogo (—) y las líneas vacías dejan
 * un hueco de separación de escena. "dialogo" se acepta como alias.
 */
export function registerDialogueBlocks(plugin: WriterPlugin): void {
	for (const lang of ["dialogue", "dialogo"]) {
		plugin.registerMarkdownCodeBlockProcessor(lang, (source, el) => {
			el.addClass("bw-dialogue");

			let blankRun = 0;
			for (const raw of source.split("\n")) {
				const line = raw.trim();
				if (line === "") {
					blankRun += 1;
					continue;
				}
				if (blankRun > 0) {
					el.createDiv({ cls: "bw-dialogue-break" });
					blankRun = 0;
				}

				const text = line.replace(DASH_PREFIX, "").trim();
				const row = el.createDiv({ cls: "bw-dialogue-line" });
				row.createSpan({ cls: "bw-dialogue-dash", text: "—" });
				row.createSpan({ cls: "bw-dialogue-text", text });
			}
		});
	}
}