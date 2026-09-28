import { EditorView } from "@codemirror/view";
import { App, MarkdownView, Notice, TFile } from "obsidian";
import type WriterPlugin from "../main";
import { countWordsInText } from "../stats/count";
import { bodyOf } from "../vault/schema";
import { div, num } from "./dom";

/**
 * Modo escritura: oculta la interfaz, limita el ancho de línea, centra el
 * cursor y lleva el control de la sesión. Se sale con Escape.
 */
export class FocusMode {
	app: App;
	plugin: WriterPlugin;
	active = false;

	private overlay: HTMLElement | null = null;
	private ticker: number | null = null;
	private raf: number | null = null;
	private lastHead = -1;
	private sessionStart = 0;
	private keyHandler: ((ev: KeyboardEvent) => void) | null = null;
	private startWords = 0;
	private warned = false;

	constructor(app: App, plugin: WriterPlugin) {
		this.app = app;
		this.plugin = plugin;
	}

	get isActive(): boolean {
		return this.active;
	}

	async enter(): Promise<void> {
		if (this.active) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice("Abre una nota para entrar en modo escritura.");
			return;
		}

		this.active = true;
		this.sessionStart = Date.now();
		this.warned = false;
		this.lastHead = -1;

		document.body.addClass("bw-focus-mode");
		this.app.workspace.containerEl.addClass("bw-focus-active");

		// arranca la sesión de escritura si no hay ninguna
		if (!this.plugin.sessions.isRunning) {
			await this.plugin.sessions.start(this.currentFile());
		}
		this.startWords = this.plugin.lastLiveWords;

		this.buildOverlay();
		this.bindEscape();
		this.startTicker();
		this.startTypewriter();
	}

	exit(): void {
		if (!this.active) return;
		this.active = false;

		document.body.removeClass("bw-focus-mode");
		this.app.workspace.containerEl.removeClass("bw-focus-active");

		this.overlay?.remove();
		this.overlay = null;

		if (this.keyHandler) {
			document.removeEventListener("keydown", this.keyHandler, true);
			this.keyHandler = null;
		}
		if (this.ticker !== null) {
			window.clearInterval(this.ticker);
			this.ticker = null;
		}
		if (this.raf !== null) {
			window.cancelAnimationFrame(this.raf);
			this.raf = null;
		}
		this.lastHead = -1;

		// cierra la sesión de escritura y refresca la cabecera de la escena
		const book = this.plugin.activeBook;
		if (this.plugin.sessions.isRunning && book) {
			void this.plugin.sessions.stop(book).then((session) => {
				if (session?.notePath) return this.plugin.syncSceneHeader(session.notePath);
				return undefined;
			});
		}

		void this.plugin.refreshAll();
	}

	toggle(): void {
		if (this.active) this.exit();
		else void this.enter();
	}

	// ------------------------------------------------------------ overlay

	private buildOverlay(): void {
		const overlay = div("bw-focus-hud");
		overlay.appendChild(div("bw-focus-goal", this.plugin.activeBook || "Sin libro"));

		const stats = div("bw-focus-stats");
		stats.id = "bw-focus-stats";
		overlay.appendChild(stats);

		const exit = div("bw-focus-exit", "Esc para salir");
		overlay.appendChild(exit);

		document.body.appendChild(overlay);
		this.overlay = overlay;
		this.updateOverlay();
	}

	private updateOverlay(): void {
		const target = document.getElementById("bw-focus-stats");
		if (!target) return;

		const elapsed = Math.max(0, Math.round((Date.now() - this.sessionStart) / 1000));
		const goalSeconds = this.plugin.settings.sessionMinutes * 60;
		const over = elapsed >= goalSeconds;

		const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
		const countdown = over
			? `+${fmt(elapsed - goalSeconds)}`
			: `${fmt(elapsed)} / ${fmt(goalSeconds)}`;

		const words = this.plugin.lastLiveWords;
		const goal = this.plugin.settings.dailyGoal;
		const pct = goal > 0 ? Math.round((words / goal) * 100) : 0;
		const added = Math.max(0, words - this.startWords);

		target.empty();
		const clock = div(`bw-focus-clock ${over ? "is-over" : ""}`, countdown);
		target.appendChild(clock);
		target.appendChild(div("bw-focus-words", `${num(words)} palabras hoy`));
		target.appendChild(div("bw-focus-added", `+${num(added)} en esta sesión`));
		target.appendChild(div("bw-focus-pct", `${pct}% de la meta`));
	}

	private startTicker(): void {
		this.ticker = window.setInterval(() => {
			this.updateOverlay();
			this.warnIfSessionComplete();
		}, 1000);
	}

	/** Avisa una sola vez cuando se cumple el objetivo de la sesión. */
	private warnIfSessionComplete(): void {
		if (this.warned) return;
		const goal = this.plugin.settings.sessionMinutes * 60;
		if (goal <= 0) return;
		if (Date.now() - this.sessionStart < goal * 1000) return;

		this.warned = true;
		new Notice(
			`Sesión de ${this.plugin.settings.sessionMinutes} min completada. Hoy llevas ${num(
				this.plugin.lastLiveWords
			)} palabras.`
		);
	}

	// --------------------------------------------------------- typewriter

	private currentFile(): TFile | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return view?.file ?? null;
	}

	private editorView(): EditorView | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return null;
		return (view.editor as unknown as { cm?: EditorView }).cm ?? null;
	}

	/** Mantiene la línea del cursor en el centro vertical del editor. */
	private startTypewriter(): void {
		if (!this.plugin.settings.focusTypewriter) return;

		const loop = () => {
			if (!this.active) return;

			const cm = this.editorView();
			if (cm) {
				const head = cm.state.selection.main.head;
				if (head !== this.lastHead) {
					this.lastHead = head;
					cm.dispatch({
						effects: EditorView.scrollIntoView(head, { y: "center" }),
					});
				}
			}
			this.raf = requestAnimationFrame(loop);
		};

		this.raf = requestAnimationFrame(loop);
	}

	// ------------------------------------------------------------- escape

	private bindEscape(): void {
		this.keyHandler = (ev: KeyboardEvent) => {
			if (ev.key !== "Escape") return;
			ev.preventDefault();
			ev.stopPropagation();
			this.exit();
		};
		document.addEventListener("keydown", this.keyHandler, true);
	}

	/** Llamado por el editor en cada cambio, para refrescar el HUD. */
	async onEditorChange(): Promise<void> {
		if (!this.active) return;
		const file = this.currentFile();
		if (!file) return;
		const source = await this.app.vault.read(file);
		this.plugin.lastLiveWords = countWordsInText(bodyOf(source), {
			countHeadings: this.plugin.settings.countHeadings,
		});
		this.updateOverlay();
	}
}
