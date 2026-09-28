import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { registerCommands } from "./commands";
import { DEFAULT_SETTINGS, WriterSettings, WriterSettingTab } from "./settings";
import { SessionTracker } from "./stats/sessions";
import { todayKey } from "./stats/dates";
import { FM, ROLE_LABELS, SceneStatus, STATUS_LABELS, STATUS_ORDER, VIEW_TYPE_WRITER } from "./types";
import { registerDialogueBlocks } from "./ui/dialogue";
import { FocusMode } from "./ui/focus";
import { NamePickerModal, roleOptions, ScenePickerModal, TextAndSelectModal, TextPromptModal, worldKindOptions } from "./ui/modals";
import { WriterSidebar } from "./ui/sidebar";
import { num } from "./ui/dom";
import { BookRepository } from "./vault/repository";
import { writeFrontMatter } from "./vault/schema";
import {
	bookRoot,
	createBook,
	createChapter,
	createCharacter,
	createScene,
	createWorldEntry,
	ensureFolder,
	getOrCreateDailyLog,
	readChapters,
} from "./vault/structure";

export default class WriterPlugin extends Plugin {
	settings: WriterSettings = { ...DEFAULT_SETTINGS };
	repo!: BookRepository;
	sessions!: SessionTracker;
	focus!: FocusMode;

	/** Palabras de la nota abierta, refrescadas en cada cambio. */
	lastLiveWords = 0;

	private statusBarEl: HTMLElement | null = null;
	private sidebar: WriterSidebar | null = null;
	private refreshQueued = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.repo = new BookRepository(this.app, this.settings);
		this.sessions = new SessionTracker(this.app, this.settings, this.repo);
		this.focus = new FocusMode(this.app, this);

		this.addSettingTab(new WriterSettingTab(this.app, this));
		registerCommands(this);
		registerDialogueBlocks(this);

		this.registerView(VIEW_TYPE_WRITER, (leaf: WorkspaceLeaf) => {
			this.sidebar = new WriterSidebar(leaf, this);
			return this.sidebar;
		});

		this.app.workspace.onLayoutReady(() => {
			void this.restoreSidebar();
		});

		if (this.settings.showStatusBar) this.addStatusBar();

		this.registerVaultEvents();
		this.registerWorkspaceEvents();
	}

	onunload(): void {
		this.focus.exit();
		this.statusBarEl = null;
	}

	// ------------------------------------------------------------ settings

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<WriterSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.repo.settings = this.settings;
		this.sessions.settings = this.settings;
	}

	get activeBook(): string {
		return this.settings.currentBook;
	}

	async setActiveBook(name: string): Promise<void> {
		this.settings.currentBook = name;
		await this.saveSettings();
		this.lastLiveWords = 0;
		this.refreshAll();
	}

	// -------------------------------------------------------------- eventos

	private registerVaultEvents(): void {
		const invalidate = () => {
			this.repo.invalidate();
			this.queueRefresh();
			this.updateStatusBar();
		};

		this.registerEvent(this.app.vault.on("modify", invalidate));
		this.registerEvent(this.app.vault.on("create", invalidate));
		this.registerEvent(this.app.vault.on("delete", invalidate));
		this.registerEvent(this.app.vault.on("rename", invalidate));
		this.registerEvent(this.app.metadataCache.on("changed", () => this.queueRefresh()));
	}

	private registerWorkspaceEvents(): void {
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				void this.onLeafChange();
			})
		);
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor, info) => {
				void this.onEditorChange(editor, info);
			})
		);
	}

	private async onLeafChange(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (file) await this.updateLiveWords(file);
		else this.lastLiveWords = 0;

		if (!this.settings.autoDetectBook) return;
		if (!file) return;

		const book = this.repo.bookOfFile(file);
		if (book && book !== this.settings.currentBook) {
			await this.setActiveBook(book);
		}
	}

	private async onEditorChange(
		editor: unknown,
		info: { file?: TFile | null } | undefined
	): Promise<void> {
		void editor;
		const file = info?.file;
		if (file) await this.updateLiveWords(file);
		if (this.focus.isActive) await this.focus.onEditorChange();
	}

	private async updateLiveWords(file: TFile): Promise<void> {
		const { words } = await this.repo.countFile(file);
		this.lastLiveWords = words;
		this.updateStatusBar();
	}

	// ------------------------------------------------------------- refresco

	queueRefresh(): void {
		if (this.refreshQueued) return;
		this.refreshQueued = true;
		window.setTimeout(() => {
			this.refreshQueued = false;
			this.refreshViews();
		}, 400);
	}

	refreshViews(): void {
		this.sidebar?.render();
	}

	async refreshAll(): Promise<void> {
		this.repo.invalidate();
		this.refreshViews();
		this.updateStatusBar();
	}

	updateStatusBar(): void {
		if (!this.statusBarEl) return;
		const el = this.statusBarEl;
		el.empty();

		const goal = this.settings.dailyGoal;
		const words = this.lastLiveWords;
		el.appendChild(el.createSpan({ cls: "bw-statusbar-words", text: `${num(words)} palabras` }));

		if (goal > 0) {
			const pct = Math.round((words / goal) * 100);
			el.appendChild(el.createSpan({ cls: "bw-statusbar-goal", text: ` / ${num(goal)} (${pct}%)` }));
		}

		if (this.sessions.isRunning) {
			el.appendChild(el.createSpan({ cls: "bw-statusbar-live", text: ` ${this.sessions.elapsedMinutes} min` }));
		}
	}

	private addStatusBar(): void {
		this.statusBarEl = this.addStatusBarItem();
		this.updateStatusBar();
	}

	// ------------------------------------------------------------- sidebar

	async openSidebar(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_WRITER);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			this.refreshViews();
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_WRITER, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	private async restoreSidebar(): Promise<void> {
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE_WRITER).length > 0) {
			this.refreshViews();
			return;
		}
		await this.openSidebar();
	}

	// --------------------------------------------------------- flujo: libros

	async newBookFlow(): Promise<void> {
		new TextPromptModal(this.app, {
			title: "Crear un libro",
			placeholder: "El nombre de tu libro",
			onSubmit: async (name) => {
				const existing = this.repo.listBooks().find((b) => b.name === name);
				if (existing) {
					await this.setActiveBook(name);
					new Notice(`El libro «${name}» ya existe.`);
					return;
				}

				await createBook(this.app, this.settings, name);
				await this.setActiveBook(name);
				this.repo.invalidate();
				await this.refreshAll();
				new Notice(`Libro «${name}» creado.`);
			},
		}).open();
	}

	// ------------------------------------------------------ flujo: manuscrito

	async newChapterFlow(): Promise<void> {
		if (!(await this.ensureBook())) return;

		new TextPromptModal(this.app, {
			title: "Nuevo capítulo",
			placeholder: "Capítulo 1",
			onSubmit: async (title) => {
				const book = this.activeBook;
				const { firstScene } = await createChapter(this.app, this.settings, book, title);
				this.repo.invalidate();
				await this.refreshAll();
				new Notice(`Capítulo «${title}» creado.`);
				if (firstScene) await this.app.workspace.getLeaf(false).openFile(firstScene);
			},
		}).open();
	}

	async newSceneFlow(chapterTitle?: string): Promise<void> {
		if (!(await this.ensureBook())) return;

		const book = this.activeBook;
		const chapters = await readChapters(this.app, this.settings, book);
		if (chapters.length === 0) {
			new Notice("Crea un capítulo primero.");
			await this.newChapterFlow();
			return;
		}

		const options = chapters.map((c) => ({ value: c.title, label: `${c.order}. ${c.title}` }));
		const initial = chapterTitle ?? options[options.length - 1].value;

		new TextAndSelectModal(this.app, {
			title: "Nueva escena",
			textLabel: "Título de la escena",
			textPlaceholder: "Escena 1",
			selectLabel: "Capítulo",
			selectOptions: options,
			selectValue: initial,
			onSubmit: async (title, chapter) => {
				const file = await createScene(this.app, this.settings, book, { title, chapterTitle: chapter });
				this.repo.invalidate();
				await this.refreshAll();
				await this.app.workspace.getLeaf(false).openFile(file);
			},
		}).open();
	}

	async openScenePicker(): Promise<void> {
		if (!(await this.ensureBook())) return;
		const scenes = await this.repo.getScenes(this.activeBook);
		if (scenes.length === 0) {
			new Notice("No hay escenas todavía.");
			return;
		}
		new ScenePickerModal(this.app, scenes, (scene) => {
			const file = this.app.vault.getAbstractFileByPath(scene.path);
			if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
		}).open();
	}

	// ---------------------------------------------------------- flujo: fichas

	async newCharacterFlow(name?: string): Promise<void> {
		if (!(await this.ensureBook())) return;
		const book = this.activeBook;

		new TextAndSelectModal(this.app, {
			title: "Nuevo personaje",
			textLabel: "Nombre",
			textPlaceholder: "Nombre y apellido",
			textValue: name ?? "",
			selectLabel: "Rol",
			selectOptions: roleOptions(),
			selectValue: "secondary",
			onSubmit: async (text, role) => {
				const file = await createCharacter(
					this.app,
					this.settings,
					book,
					text,
					role as "protagonist" | "antagonist" | "secondary" | "minor"
				);
				this.repo.invalidate();
				await this.refreshAll();
				await this.app.workspace.getLeaf(false).openFile(file);
			},
		}).open();
	}

	async newWorldFlow(): Promise<void> {
		if (!(await this.ensureBook())) return;
		const book = this.activeBook;

		new TextAndSelectModal(this.app, {
			title: "Nuevo elemento de mundo",
			textLabel: "Nombre",
			textPlaceholder: "Ciudad, objeto, facción…",
			selectLabel: "Tipo",
			selectOptions: worldKindOptions(),
			selectValue: "Lugar",
			onSubmit: async (text, kind) => {
				const file = await createWorldEntry(this.app, this.settings, book, text, kind);
				this.repo.invalidate();
				await this.refreshAll();
				await this.app.workspace.getLeaf(false).openFile(file);
			},
		}).open();
	}

	async setPovForScene(file: TFile): Promise<void> {
		if (!file) return;
		const book = this.activeBook;

		// pasando las escenas, getCharacters añade también los POV que aún no
		// tienen ficha, que es justo cuando se asigna uno
		const scenes = await this.repo.getScenes(book);
		const characters = await this.repo.getCharacters(book, scenes);

		const items = [
			{ name: "— sin POV —", path: "", hint: "dejar la escena sin punto de vista" },
			...characters.map((c) => ({
				name: c.name,
				path: c.path,
				hint: c.path ? ROLE_LABELS[c.role] : `${ROLE_LABELS[c.role]} · sin ficha`,
			})),
		];

		new NamePickerModal(this.app, items, "Punto de vista", (picked) => {
			void (async () => {
				await writeFrontMatter(this.app, file, {
					[FM.POV]: picked.name === "— sin POV —" ? "" : picked.name,
				});
				this.repo.invalidate();
				await this.refreshAll();
				new Notice(picked.name === "— sin POV —" ? "Escena sin POV" : `POV: ${picked.name}`);
			})();
		}).open();
	}

	// ------------------------------------------------------------- escenas

	async cycleSceneStatus(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		const current = this.currentStatus(file);
		const next = STATUS_ORDER[(STATUS_ORDER.indexOf(current) + 1) % STATUS_ORDER.length];
		await writeFrontMatter(this.app, file, { [FM.STATUS]: next });
		this.repo.invalidate();
		await this.refreshAll();
		new Notice(`Estado: ${STATUS_LABELS[next]}`);
	}

	private currentStatus(file: TFile): SceneStatus {
		const anyFile = file as unknown as { getFrontMatter?: () => Record<string, unknown> };
		const data = anyFile.getFrontMatter ? anyFile.getFrontMatter() : {};
		const raw = String(data[FM.STATUS] ?? "draft") as SceneStatus;
		return STATUS_ORDER.includes(raw) ? raw : "draft";
	}

	// ------------------------------------------------------------- sesiones

	async startSession(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		await this.sessions.start(view?.file ?? null);
		if (this.sessions.isRunning) {
			new Notice("Sesión de escritura iniciada. Esc cuando termines.");
		}
		this.updateStatusBar();
	}

	async stopSession(): Promise<void> {
		await this.sessions.stop(this.activeBook);
		this.repo.invalidate();
		await this.refreshAll();
	}

	async toggleFocus(): Promise<void> {
		if (this.focus.isActive) {
			this.focus.exit();
			return;
		}
		await this.focus.enter();
	}

	/** Abre la escena en la que más probablemente quieras seguir. */
	async continueWriting(): Promise<void> {
		if (!(await this.ensureBook())) return;
		const book = this.activeBook;

		// 1. la última escena tocada
		const scenes = await this.repo.getScenes(book);
		if (scenes.length === 0) {
			await this.newChapterFlow();
			return;
		}

		const openInEditor = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		const current = openInEditor ? scenes.find((s) => s.path === openInEditor.path) : undefined;
		if (current && current.status !== "done") {
			await this.app.workspace.getLeaf(false).openFile(this.fileOf(current.path));
			return;
		}

		// 2. la escena más reciente sin terminar
		const pending =
			scenes.find((s) => s.status === "draft") ??
			scenes.find((s) => s.status === "revision") ??
			scenes.find((s) => s.status === "outline");

		if (pending) {
			await this.app.workspace.getLeaf(false).openFile(this.fileOf(pending.path));
			return;
		}

		// 3. la última escena en cualquier estado
		const last = scenes[scenes.length - 1];
		await this.app.workspace.getLeaf(false).openFile(this.fileOf(last.path));
	}

	private fileOf(path: string): TFile {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) return file;
		throw new Error(`No se encontró ${path}`);
	}

	// ---------------------------------------------------------------- notas

	async openTodayLog(): Promise<void> {
		if (!(await this.ensureBook())) return;
		const log = await getOrCreateDailyLog(this.app, this.settings, this.activeBook, todayKey());
		await this.app.workspace.getLeaf(false).openFile(log);
	}

	/** Escribe (o actualiza) una nota con el resumen del día. */
	async writeDailySummary(): Promise<void> {
		if (!(await this.ensureBook())) return;
		const book = this.activeBook;
		const date = todayKey();
		const log = await getOrCreateDailyLog(this.app, this.settings, book, date);

		const m = await this.repo.buildManuscript(book);
		const today = m.daily.find((d) => d.date === date);
		const words = today?.words ?? 0;
		const minutes = today?.minutes ?? 0;
		const sessions = m.daily.find((d) => d.date === date);

		const goal = this.settings.dailyGoal;
		const pct = goal > 0 ? Math.round((words / goal) * 100) : 0;

		const block = [
			"## Resumen del día",
			"",
			`- **Palabras:** ${num(words)}${goal > 0 ? ` de ${num(goal)} (${pct}%)` : ""}`,
			`- **Tiempo:** ${minutes} min`,
			`- **Racha:** ${m.streak} días seguidos`,
			`- **Total del manuscrito:** ${num(m.words)} palabras en ${m.scenes.length} escenas`,
			"",
		].join("\n");

		const content = await this.app.vault.read(log);
		if (content.includes("## Resumen del día")) {
			const updated = content.replace(/## Resumen del día[\s\S]*?(?=\n## |\s*$)/, block.trimEnd());
			await this.app.vault.modify(log, updated);
		} else {
			await this.app.vault.append(log, `\n${block}`);
		}

		void sessions;
		this.repo.invalidate();
		await this.refreshAll();
		await this.app.workspace.getLeaf(false).openFile(log);
		new Notice("Resumen de hoy guardado en la nota del día.");
	}

	/** Guarda un recuento completo del manuscrito en una nota. */
	async writeProgressNote(): Promise<void> {
		if (!(await this.ensureBook())) return;
		const book = this.activeBook;
		const m = await this.repo.buildManuscript(book);

		const byStatus = STATUS_ORDER.map(
			(s) => `- **${STATUS_LABELS[s]}:** ${m.byStatus[s]}`
		).join("\n");

		const chapters = m.chapters
			.map(
				(c) =>
					`### ${c.title}\n\n${num(c.words)} palabras · ${c.scenes.length} escenas\n\n${c.scenes
						.map((s) => `- ${s.title} — ${num(s.words)} palabras${s.pov ? ` · POV: ${s.pov}` : ""}`)
						.join("\n")}`
			)
			.join("\n\n");

		const content = [
			`# Recuento — ${book}`,
			"",
			`> Generado el ${todayKey()}`,
			"",
			"## Cifras",
			"",
			`- **Total:** ${num(m.words)} palabras`,
			`- **Escenas:** ${m.scenes.length}`,
			`- **Promedio por escena:** ${num(m.wordsPerScene)} palabras`,
			`- **Racha actual:** ${m.streak} días (mejor: ${m.bestStreak})`,
			`- **Esta semana:** ${num(m.week)} palabras`,
			"",
			"## Estado de las escenas",
			"",
			byStatus,
			"",
			"## Por capítulos",
			"",
			chapters || "_(sin capítulos)_",
			"",
		].join("\n");

		const path = normalizePath(`${bookRoot(this.settings, book)}/Recuento.md`);
		const existing = this.app.vault.getAbstractFileByPath(path);

		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
			await this.app.workspace.getLeaf(false).openFile(existing);
		} else {
			await ensureFolder(this.app.vault, bookRoot(this.settings, book));
			const file = await this.app.vault.create(path, content);
			await this.app.workspace.getLeaf(false).openFile(file);
		}
		new Notice("Recuento guardado.");
	}

	// --------------------------------------------------------------- utils

	/** Devuelve false si no hay libro, pidiendo uno antes. */
	private async ensureBook(): Promise<boolean> {
		if (this.activeBook) return true;
		new Notice("Primero crea un libro.");
		await this.newBookFlow();
		return false;
	}
}
