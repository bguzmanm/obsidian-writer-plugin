import { Notice, Plugin } from "obsidian";
import type WriterPlugin from "../main";
import { countWordsInText } from "../stats/count";

export function registerCommands(plugin: WriterPlugin): void {
	const p: Plugin = plugin;

	p.addCommand({
		id: "open-panel",
		name: "Abrir el panel del libro",
		callback: () => void plugin.openSidebar(),
	});

	p.addCommand({
		id: "new-book",
		name: "Crear un libro nuevo",
		callback: () => void plugin.newBookFlow(),
	});

	p.addCommand({
		id: "new-chapter",
		name: "Manuscrito: nuevo capítulo",
		callback: () => void plugin.newChapterFlow(),
	});

	p.addCommand({
		id: "new-scene",
		name: "Manuscrito: nueva escena",
		callback: () => void plugin.newSceneFlow(),
	});

	p.addCommand({
		id: "new-character",
		name: "Fichero: nuevo personaje",
		callback: () => void plugin.newCharacterFlow(),
	});

	p.addCommand({
		id: "new-world-entry",
		name: "Fichero: nuevo elemento de mundo",
		callback: () => void plugin.newWorldFlow(),
	});

	p.addCommand({
		id: "new-daily-log",
		name: "Registro: abrir la nota de hoy",
		callback: () => void plugin.openTodayLog(),
	});

	p.addCommand({
		id: "focus-mode",
		name: "Entrar en modo escritura",
		callback: () => void plugin.toggleFocus(),
	});

	p.addCommand({
		id: "start-session",
		name: "Empezar una sesión de escritura",
		callback: () => void plugin.startSession(),
	});

	p.addCommand({
		id: "stop-session",
		name: "Terminar la sesión de escritura",
		callback: () => void plugin.stopSession(),
	});

	p.addCommand({
		id: "continue-writing",
		name: "Seguir escribiendo donde lo dejaste",
		callback: () => void plugin.continueWriting(),
	});

	p.addCommand({
		id: "count-words",
		name: "Contar palabras de la nota actual",
		editorCallback: async (editor, view) => {
			if (!view.file) return;
			const words = await plugin.repo.countFile(view.file);
			new Notice(`${words.words} palabras · ${words.chars} caracteres`);
			void editor;
		},
	});

	p.addCommand({
		id: "insert-synopsis",
		name: "Escena: insertar la estructura de sinopsis",
		editorCallback: async (editor, view) => {
			const template = [
				"## Sinopsis",
				"",
				"**Qué quiere el POV:** ",
				"**Qué se opone:** ",
				"**Qué cambia al final:** ",
				"",
				"## Escena",
				"",
				"",
			].join("\n");

			editor.replaceSelection(template);
			void view;
		},
	});

	p.addCommand({
		id: "daily-summary",
		name: "Registro: escribir el resumen de hoy en una nota",
		callback: () => void plugin.writeDailySummary(),
	});

	p.addCommand({
		id: "progress-note",
		name: "Manuscrito: guardar el recuento en una nota",
		callback: () => void plugin.writeProgressNote(),
	});

	p.addCommand({
		id: "set-pov",
		name: "Escena: elegir el punto de vista",
		editorCallback: async (editor, view) => {
			if (!view.file) return;
			await plugin.setPovForScene(view.file);
			void editor;
		},
	});

	p.addCommand({
		id: "set-characters",
		name: "Escena: marcar los personajes presentes",
		editorCallback: async (editor, view) => {
			if (!view.file) return;
			await plugin.setCharactersForScene(view.file);
			void editor;
		},
	});

	p.addCommand({
		id: "cycle-status",
		name: "Escena: cambiar el estado",
		editorCallback: async (editor, view) => {
			if (!view.file) return;
			await plugin.cycleSceneStatus(view.file.path);
			void editor;
		},
	});

	p.addCommand({
		id: "count-words-in-selection",
		name: "Contar palabras de la selección",
		editorCallback: async (editor) => {
			const text = editor.getSelection();
			if (!text || !text.trim()) {
				new Notice("No hay selección.");
				return;
			}
			const words = countWordsInText(text, { countHeadings: true });
			const chars = text.replace(/\s/g, "").length;
			new Notice(`${words} palabras · ${chars} caracteres`);
		},
	});

	p.addCommand({
		id: "open-scene",
		name: "Manuscrito: abrir una escena",
		callback: () => void plugin.openScenePicker(),
	});
}
