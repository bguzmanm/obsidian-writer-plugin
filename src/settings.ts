import { App, PluginSettingTab, Setting } from "obsidian";
import type WriterPlugin from "./main";

export interface WriterSettings {
	/** Carpeta raíz donde viven los libros. */
	booksFolder: string;
	/** Libro seleccionado actualmente. */
	currentBook: string;
	dailyGoal: number;
	weeklyGoal: number;
	/** Sesión objetivo en minutos para el modo escritura. */
	sessionMinutes: number;
	/** Ocultar paneles laterales al entrar en modo escritura. */
	focusHideUI: boolean;
	/** Mantener el cursor centrado verticalmente. */
	focusTypewriter: boolean;
	/** Mostrar el contador de palabras en la barra de estado. */
	showStatusBar: boolean;
	/** Contar también los encabezados de markdown como palabras. */
	countHeadings: boolean;
	/** Recordar el libro seleccionado por libro abierto. */
	autoDetectBook: boolean;
	/** Palabras objetivo para terminar el manuscrito. */
	bookGoal: number;
}

export const DEFAULT_SETTINGS: WriterSettings = {
	booksFolder: "Libros",
	currentBook: "",
	dailyGoal: 500,
	weeklyGoal: 3500,
	sessionMinutes: 45,
	focusHideUI: true,
	focusTypewriter: true,
	showStatusBar: true,
	countHeadings: false,
	autoDetectBook: true,
	bookGoal: 80000,
};

export class WriterSettingTab extends PluginSettingTab {
	plugin: WriterPlugin;

	constructor(app: App, plugin: WriterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Estructura").setHeading();

		new Setting(containerEl)
			.setName("Carpeta de libros")
			.setDesc("Dónde se crean las carpetas de cada libro.")
			.addText((text) =>
				text
					.setPlaceholder("Libros")
					.setValue(this.plugin.settings.booksFolder)
					.onChange(async (value) => {
						this.plugin.settings.booksFolder = value.trim() || DEFAULT_SETTINGS.booksFolder;
						await this.plugin.saveSettings();
					})
			);

		const books = this.plugin.repo.listBooks();
		new Setting(containerEl)
			.setName("Libro activo")
			.setDesc("El libro sobre el que trabajan el panel y las estadísticas.")
			.addDropdown((dd) => {
				dd.addOption("", "— ninguno —");
				for (const b of books) dd.addOption(b.name, b.name);
				dd.setValue(this.plugin.settings.currentBook).onChange(async (value) => {
					await this.plugin.setActiveBook(value);
				});
			});

		new Setting(containerEl)
			.setName("Detectar libro automáticamente")
			.setDesc("Cambiar al libro de la nota que está abierta en el editor.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.autoDetectBook).onChange(async (value) => {
					this.plugin.settings.autoDetectBook = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("Metas").setHeading();

		new Setting(containerEl)
			.setName("Meta diaria")
			.setDesc("Palabras por día.")
			.addText((text) =>
				text
					.setPlaceholder("500")
					.setValue(String(this.plugin.settings.dailyGoal))
					.onChange(async (value) => {
						this.plugin.settings.dailyGoal = Math.max(0, Number(value) || 0);
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Meta semanal")
			.setDesc("Palabras por semana.")
			.addText((text) =>
				text
					.setPlaceholder("3500")
					.setValue(String(this.plugin.settings.weeklyGoal))
					.onChange(async (value) => {
						this.plugin.settings.weeklyGoal = Math.max(0, Number(value) || 0);
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl)
			.setName("Extensión estimada del libro")
			.setDesc("Palabras objetivo para el manuscrito completo.")
			.addText((text) =>
				text
					.setPlaceholder("80000")
					.setValue(String(this.plugin.settings.bookGoal))
					.onChange(async (value) => {
						this.plugin.settings.bookGoal = Math.max(0, Number(value) || 0);
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					})
			);

		new Setting(containerEl).setName("Modo escritura").setHeading();

		new Setting(containerEl)
			.setName("Duración de la sesión")
			.setDesc("Minutos objetivo de cada sesión de escritura enfocada.")
			.addSlider((s) =>
				s
					.setLimits(5, 240, 5)
					.setValue(this.plugin.settings.sessionMinutes)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.sessionMinutes = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Ocultar la interfaz al escribir")
			.setDesc("Oculta paneles laterales y barras al entrar en modo escritura.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.focusHideUI).onChange(async (value) => {
					this.plugin.settings.focusHideUI = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Cursores centrados")
			.setDesc("Mantiene la línea que escribes en el centro vertical de la pantalla.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.focusTypewriter).onChange(async (value) => {
					this.plugin.settings.focusTypewriter = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("Interfaz").setHeading();

		new Setting(containerEl)
			.setName("Contador en la barra de estado")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showStatusBar).onChange(async (value) => {
					this.plugin.settings.showStatusBar = value;
					await this.plugin.saveSettings();
					this.plugin.updateStatusBar();
				})
			);

		new Setting(containerEl)
			.setName("Contar encabezados")
			.setDesc("Incluye los títulos de markdown en el recuento de palabras.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.countHeadings).onChange(async (value) => {
					this.plugin.settings.countHeadings = value;
					await this.plugin.saveSettings();
				})
			);
	}
}
