import { ItemView, Menu, TFile, WorkspaceLeaf } from "obsidian";
import type WriterPlugin from "../main";
import { VIEW_TYPE_WRITER, Manuscript, STATUS_LABELS, STATUS_ORDER, SceneStatus, ROLE_LABELS } from "../types";
import { button, div, empty, link, make, minutesText, num, progressBar, section, span, statRow } from "./dom";

type TabId = "progreso" | "manuscrito" | "fichero";

const TABS: { id: TabId; label: string; icon: string }[] = [
	{ id: "progreso", label: "Progreso", icon: "lucide-activity" },
	{ id: "manuscrito", label: "Manuscrito", icon: "lucide-book-open" },
	{ id: "fichero", label: "Fichero", icon: "lucide-users" },
];

export class WriterSidebar extends ItemView {
	plugin: WriterPlugin;
	tab: TabId = "progreso";
	private rendering = false;
	private renderQueued = false;

	constructor(leaf: WorkspaceLeaf, plugin: WriterPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.icon = "lucide-feather";
	}

	getViewType(): string {
		return VIEW_TYPE_WRITER;
	}

	getDisplayText(): string {
		const book = this.plugin.activeBook;
		return book ? `Writer — ${book}` : "Writer";
	}

	getIcon(): string {
		return "lucide-feather";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/**
	 * Re-dibuja el panel. Seguro de llamar desde eventos del vault.
	 *
	 * Los eventos del vault llegan en ráfaga al crear un capítulo o una escena.
	 * Si uno coincide con un dibujado en curso, antes se descartaba y el panel
	 * se quedaba con los datos viejos: el archivo existía pero no se veía. Ahora
	 * se anota que hay redibujado pendiente y se repite al terminar.
	 */
	render(): void {
		if (this.rendering) {
			this.renderQueued = true;
			return;
		}
		this.rendering = true;

		const container = this.contentEl;
		container.empty();
		container.addClass("bw-panel");

		container.appendChild(this.renderHeader());
		container.appendChild(this.renderTabs());

		const body = div("bw-body");
		container.appendChild(body);

		void this.renderTab(body).finally(() => {
			this.rendering = false;
			if (this.renderQueued) {
				this.renderQueued = false;
				this.render();
			}
		});
	}

	// ------------------------------------------------------------- cabecera

	private renderHeader(): HTMLElement {
		const header = div("bw-header");

		const books = this.plugin.repo.listBooks();
		if (books.length === 0) {
			header.appendChild(div("bw-book-name", "Sin libros todavía"));
			header.appendChild(
				button("Crear libro", () => void this.plugin.newBookFlow(), {
					title: "Crea tu primer libro: crea la carpeta, las notas de capítulo y la de personajes",
				})
			);
			return header;
		}

		const select = make("select", "bw-book-select") as HTMLSelectElement;
		select.title = "Libro activo";
		select.setAttribute("aria-label", "Libro activo");
		for (const b of books) {
			const opt = make("option", undefined, b.name) as HTMLOptionElement;
			opt.value = b.name;
			if (b.name === this.plugin.activeBook) opt.selected = true;
			select.appendChild(opt);
		}
		select.addEventListener("change", () => {
			void this.plugin.setActiveBook(select.value);
		});
		header.appendChild(select);

		const right = div("bw-header-actions");

		const running = this.plugin.sessions.isRunning;
		right.appendChild(
			button(
				running ? "Terminar" : "Escribir",
				() => void this.plugin.toggleFocus(),
				{
					cls: "bw-btn-primary",
					title: running
						? "Cierra el modo escritura y guarda la sesión en curso"
						: "Entra en modo escritura: oculta la interfaz y centra el cursor",
				}
			)
		);

		right.appendChild(
			button("Acciones", (ev) => this.openBookMenu(ev), {
				title: "Crear capítulos, escenas, personajes y ver el recuento",
			})
		);

		header.appendChild(right);
		return header;
	}

	private openBookMenu(ev: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((i) =>
			i.setTitle("Nuevo libro").onClick(() => void this.plugin.newBookFlow())
		);
		menu.addItem((i) =>
			i.setTitle("Nuevo capítulo").onClick(() => void this.plugin.newChapterFlow())
		);
		menu.addItem((i) =>
			i.setTitle("Nueva escena").onClick(() => void this.plugin.newSceneFlow())
		);
		menu.addItem((i) => i.setTitle("Nuevo personaje").onClick(() => void this.plugin.newCharacterFlow()));
		menu.addItem((i) => i.setTitle("Nuevo elemento de mundo").onClick(() => void this.plugin.newWorldFlow()));
		menu.addSeparator();
		menu.addItem((i) =>
			i.setTitle("Resumen de hoy en una nota").onClick(() => void this.plugin.writeDailySummary())
		);
		menu.addItem((i) =>
			i.setTitle("Recuento del manuscrito").onClick(() => void this.plugin.writeProgressNote())
		);
		menu.addItem((i) => i.setTitle("Recargar panel").onClick(() => this.render()));
		menu.showAtMouseEvent(ev);
	}

	// --------------------------------------------------------------- tabs

	private renderTabs(): HTMLElement {
		const nav = div("bw-tabs");
		for (const tab of TABS) {
			const btn = make("button", "bw-tab", tab.label) as HTMLButtonElement;
			btn.type = "button";
			if (this.tab === tab.id) btn.addClass("is-active");
			btn.addEventListener("click", () => {
				this.tab = tab.id;
				this.render();
			});
			nav.appendChild(btn);
		}
		return nav;
	}

	private async renderTab(body: HTMLElement): Promise<void> {
		const book = this.plugin.activeBook;
		if (!book) {
			body.appendChild(
				empty("Crea un libro para empezar. Se generará la estructura de carpetas y notas que necesitas.")
			);
			return;
		}

		const manuscript = await this.plugin.repo.buildManuscript(book);
		if (this.tab === "progreso") this.renderProgress(body, manuscript);
		else if (this.tab === "manuscrito") this.renderManuscript(body, manuscript);
		else await this.renderFichero(body, manuscript);
	}

	// ------------------------------------------------------------ progreso

	private renderProgress(body: HTMLElement, m: Manuscript): void {
		const wrap = div("bw-tab-content");

		// hoy
		const todayCard = div("bw-card");
		todayCard.appendChild(div("bw-card-title", "Hoy"));
		todayCard.appendChild(
			statRow(
				"Palabras",
				`${num(m.today)} / ${num(m.todayGoal)}`,
				m.today >= m.todayGoal && m.todayGoal > 0 ? "is-goal-met" : ""
			)
		);
		if (m.todayGoal > 0) {
			todayCard.appendChild(progressBar(m.today / m.todayGoal));
		}
		if (this.plugin.sessions.isRunning) {
			todayCard.appendChild(
				statRow("Sesión en curso", minutesText(this.plugin.sessions.elapsedMinutes), "is-live")
			);
		}
		wrap.appendChild(todayCard);

		// semana
		const weekCard = div("bw-card");
		weekCard.appendChild(div("bw-card-title", "Esta semana"));
		weekCard.appendChild(statRow("Palabras", `${num(m.week)} / ${num(m.weekGoal)}`));
		if (m.weekGoal > 0) weekCard.appendChild(progressBar(m.week / m.weekGoal));
		wrap.appendChild(weekCard);

		// rachas
		const streakCard = div("bw-card bw-card-streak");
		streakCard.appendChild(div("bw-card-title", "Racha"));
		const streakRow = div("bw-streak-row");
		streakRow.appendChild(div("bw-streak-value", String(m.streak)));
		streakRow.appendChild(div("bw-streak-label", m.streak === 1 ? "día seguido" : "días seguidos"));
		streakCard.appendChild(streakRow);
		if (m.bestStreak > 0) {
			streakCard.appendChild(statRow("Mejor racha", `${m.bestStreak} días`));
		}
		wrap.appendChild(streakCard);

		// manuscrito
		const bookCard = div("bw-card");
		bookCard.appendChild(div("bw-card-title", "Manuscrito"));
		bookCard.appendChild(statRow("Total", `${num(m.words)} palabras`));
		bookCard.appendChild(statRow("Escenas", String(m.scenes.length)));
		bookCard.appendChild(statRow("Promedio por escena", `${num(m.wordsPerScene)} palabras`));
		if (m.wordsPerScene > 0) {
			bookCard.appendChild(div("bw-hint", `A este ritmo, unas ${Math.ceil(m.wordsPerScene / 12)} escenas más.`));
		}
		const goal = this.plugin.settings.bookGoal;
		if (goal > 0) {
			bookCard.appendChild(statRow("Avance", `${Math.round((m.words / goal) * 100)}% de ${num(goal)}`));
			bookCard.appendChild(progressBar(m.words / goal));
		}
		wrap.appendChild(bookCard);

		// estados
		const statusCard = div("bw-card");
		statusCard.appendChild(div("bw-card-title", "Escenas por estado"));
		for (const status of STATUS_ORDER) {
			const count = m.byStatus[status];
			if (count === 0) continue;
			const row = div("bw-status-row");
			row.appendChild(span(`bw-dot bw-dot-${status}`));
			row.appendChild(span("bw-status-label", STATUS_LABELS[status]));
			row.appendChild(span("bw-status-count", String(count)));
			statusCard.appendChild(row);
		}
		if (m.scenes.length === 0) statusCard.appendChild(empty("Todavía no hay escenas."));
		wrap.appendChild(statusCard);

		// mapa de calor
		wrap.appendChild(this.renderHeatmap(m));

		// acciones rápidas
		const actions = div("bw-actions");
		actions.appendChild(
			button("Seguir escribiendo", () => void this.plugin.continueWriting(), {
				cls: "bw-btn-primary",
				title: "Abre la escena en la que te quedaste",
			})
		);
		actions.appendChild(
			button("Resumen de hoy", () => void this.plugin.writeDailySummary(), {
				title: "Añade el resumen de hoy a la nota del día",
			})
		);
		actions.appendChild(
			button("Guardar recuento", () => void this.plugin.writeProgressNote(), {
				title: "Guarda todas las cifras del manuscrito en una nota",
			})
		);
		actions.appendChild(
			button("Nota de hoy", () => void this.plugin.openTodayLog(), {
				title: "Abre la nota de registro de hoy",
			})
		);
		wrap.appendChild(actions);

		body.appendChild(wrap);
	}

	private renderHeatmap(m: Manuscript): HTMLElement {
		const card = div("bw-card");
		card.appendChild(div("bw-card-title", "Actividad"));

		const weeks = 16;
		const byDate = new Map(m.daily.map((d) => [d.date, d.words]));
		const grid = div("bw-heatmap");

		// columnas = semanas (lunes arriba), filas = días
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const mondayOffset = (today.getDay() + 6) % 7;
		const lastMonday = new Date(today);
		lastMonday.setDate(lastMonday.getDate() - mondayOffset);

		let max = 0;
		for (const w of byDate.values()) max = Math.max(max, w);

		for (let w = weeks - 1; w >= 0; w -= 1) {
			const col = div("bw-heat-col");
			for (let d = 0; d < 7; d += 1) {
				const cellDate = new Date(lastMonday);
				cellDate.setDate(cellDate.getDate() - w * 7 + d);
				if (cellDate > today) {
					col.appendChild(div("bw-heat-cell bw-heat-empty"));
					continue;
				}
				const key = toKey(cellDate);
				const words = byDate.get(key) ?? 0;
				const level = words === 0 ? 0 : max === 0 ? 1 : Math.ceil((words / max) * 4);
				const cell = div(`bw-heat-cell bw-heat-l${level}`);
				cell.setAttribute("title", `${key}: ${num(words)} palabras`);
				col.appendChild(cell);
			}
			grid.appendChild(col);
		}

		card.appendChild(grid);
		const legend = div("bw-heat-legend");
		legend.appendChild(span("", "menos"));
		for (let i = 0; i <= 4; i += 1) legend.appendChild(div(`bw-heat-cell bw-heat-l${i}`));
		legend.appendChild(span("", "más"));
		card.appendChild(legend);

		return card;
	}

	// ---------------------------------------------------------- manuscrito

	private renderManuscript(body: HTMLElement, m: Manuscript): void {
		const wrap = div("bw-tab-content");

		const actions = div("bw-actions");
		actions.appendChild(
			button("+ Capítulo", () => void this.plugin.newChapterFlow(), {
				title: "Crea un capítulo nuevo con su primera escena",
			})
		);
		actions.appendChild(
			button("+ Escena", () => void this.plugin.newSceneFlow(), {
				title: "Añade una escena al capítulo que elijas",
			})
		);
		wrap.appendChild(actions);

		if (m.chapters.length === 0) {
			wrap.appendChild(empty("Crea un capítulo para empezar a ordenar el manuscrito."));
			body.appendChild(wrap);
			return;
		}

		for (const chapter of m.chapters) {
			const sec = section(`${chapter.title} · ${num(chapter.words)} palabras`, chapter.order > 0 && m.chapters.length > 4);
			const bodyEl = div("bw-section-body");

			if (chapter.scenes.length === 0) {
				bodyEl.appendChild(empty("Sin escenas."));
			}

			for (const scene of chapter.scenes) {
				bodyEl.appendChild(this.renderSceneRow(scene));
			}

			bodyEl.appendChild(
				button("+ Escena en este capítulo", () => void this.plugin.newSceneFlow(chapter.title), {
					title: `Añade una escena a «${chapter.title}»`,
				})
			);

			sec.appendChild(bodyEl);
			wrap.appendChild(sec);
		}

		body.appendChild(wrap);
	}

	private renderSceneRow(scene: {
		path: string;
		title: string;
		words: number;
		status: SceneStatus;
		pov: string;
		synopsis: string;
	}): HTMLElement {
		const row = div("bw-scene");

		const head = div("bw-scene-head");
		const file = this.plugin.app.vault.getAbstractFileByPath(scene.path);
		if (file instanceof TFile) {
			head.appendChild(link(this.plugin.app, file, scene.title));
		} else {
			head.appendChild(span("bw-scene-title", scene.title));
		}

		const statusBtn = span(`bw-pill bw-pill-${scene.status}`, STATUS_LABELS[scene.status]);
		statusBtn.setAttribute("role", "button");
		statusBtn.setAttribute("tabindex", "0");
		statusBtn.setAttribute("title", "Cambiar estado");
		const cycle = (ev: Event) => {
			ev.preventDefault();
			ev.stopPropagation();
			this.plugin.cycleSceneStatus(scene.path);
		};
		statusBtn.addEventListener("click", cycle);
		statusBtn.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter" || ev.key === " ") cycle(ev);
		});
		head.appendChild(statusBtn);
		row.appendChild(head);

		const meta = div("bw-scene-meta");
		meta.appendChild(span("bw-scene-words", `${num(scene.words)} palabras`));
		if (scene.pov) meta.appendChild(span("bw-scene-pov", `POV: ${scene.pov}`));
		row.appendChild(meta);

		if (scene.synopsis) {
			row.appendChild(div("bw-scene-synopsis", scene.synopsis));
		}

		return row;
	}

	// ------------------------------------------------------------- fichero

	private async renderFichero(body: HTMLElement, m: Manuscript): Promise<void> {
		const wrap = div("bw-tab-content");

		const actions = div("bw-actions");
		actions.appendChild(
			button("+ Personaje", () => void this.plugin.newCharacterFlow(), {
				title: "Crea una ficha de personaje",
			})
		);
		actions.appendChild(
			button("+ Elemento de mundo", () => void this.plugin.newWorldFlow(), {
				title: "Crea una ficha de lugar, objeto, facción o concepto",
			})
		);
		wrap.appendChild(actions);

		const characters = await this.plugin.repo.getCharacters(m.book, m.scenes);
		const world = await this.plugin.repo.getWorldEntries(m.book);

		// personajes agrupados por rol
		const roles: (keyof typeof ROLE_LABELS)[] = ["protagonist", "antagonist", "secondary", "minor"];
		for (const role of roles) {
			const group = characters.filter((c) => c.role === role);
			if (group.length === 0) continue;

			const sec = section(`${ROLE_LABELS[role]} (${group.length})`, role === "secondary" && group.length > 3);
			const secBody = div("bw-section-body");

			for (const character of group) {
				const row = div("bw-character");

				const head = div("bw-character-head");
				if (character.path) {
					const file = this.plugin.app.vault.getAbstractFileByPath(character.path);
					if (file instanceof TFile) head.appendChild(link(this.plugin.app, file, character.name));
					else head.appendChild(span("bw-character-name", character.name));
				} else {
					head.appendChild(span("bw-character-name", character.name));
					head.appendChild(span("bw-pill bw-pill-warn", "sin ficha"));
				}
				row.appendChild(head);

				if (character.summary) {
					row.appendChild(div("bw-character-summary", character.summary));
				}

				const meta = div("bw-scene-meta");
				meta.appendChild(span("", `${character.appearsIn.length} escenas`));
				meta.appendChild(span("", character.status));
				row.appendChild(meta);

				if (character.appearsIn.length > 0) {
					const list = div("bw-mentions");
					for (const path of character.appearsIn.slice(0, 4)) {
						const file = this.plugin.app.vault.getAbstractFileByPath(path);
						if (file instanceof TFile) list.appendChild(link(this.plugin.app, file, file.basename));
					}
					if (character.appearsIn.length > 4) {
						list.appendChild(span("bw-muted", `+${character.appearsIn.length - 4} más`));
					}
					row.appendChild(list);
				}

				if (!character.path) {
					row.appendChild(
						button("Crear ficha", () => void this.plugin.newCharacterFlow(character.name), {
							title: `Crea la ficha de ${character.name}`,
						})
					);
				}

				secBody.appendChild(row);
			}

			sec.appendChild(secBody);
			wrap.appendChild(sec);
		}

		if (characters.length === 0) {
			wrap.appendChild(empty("Crea fichas de personajes para no perderlos de vista."));
		}

		// mundo
		if (world.length > 0) {
			const byKind = new Map<string, typeof world>();
			for (const entry of world) {
				const list = byKind.get(entry.kind) ?? [];
				list.push(entry);
				byKind.set(entry.kind, list);
			}

			for (const [kind, entries] of byKind) {
				const sec = section(`${kind} (${entries.length})`, true);
				const secBody = div("bw-section-body");
				for (const entry of entries) {
					const file = this.plugin.app.vault.getAbstractFileByPath(entry.path);
					const row = div("bw-world-row");
					if (file instanceof TFile) row.appendChild(link(this.plugin.app, file, entry.name));
					else row.appendChild(span("bw-link", entry.name));
					if (entry.summary) row.appendChild(div("bw-character-summary", entry.summary));
					secBody.appendChild(row);
				}
				sec.appendChild(secBody);
				wrap.appendChild(sec);
			}
		} else {
			const sec = section("Mundo (0)", true);
			sec.appendChild(div("bw-section-body", "Lugares, objetos, facciones y conceptos."));
			wrap.appendChild(sec);
		}

		body.appendChild(wrap);
	}
}

function toKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}
