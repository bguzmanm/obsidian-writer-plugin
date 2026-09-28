import { App, FuzzySuggestModal, Modal, Setting, TextComponent } from "obsidian";
import { CharacterRole, ROLE_LABELS, Scene, WorldEntry } from "../types";
import { num } from "./dom";

/** Permite confirmar con Enter sin salirse del campo de texto. */
function submitOnEnter(text: TextComponent, submit: () => void): void {
	text.inputEl.addEventListener("keydown", (ev) => {
		if (ev.key === "Enter") {
			ev.preventDefault();
			submit();
		}
	});
}

/** Modal con un único campo de texto. */
export class TextPromptModal extends Modal {
	private value: string;
	private placeholder: string;
	private title: string;
	private onSubmit: (value: string) => void;
	private minLength: number;

	constructor(
		app: App,
		opts: { title: string; value?: string; placeholder?: string; minLength?: number; onSubmit: (v: string) => void }
	) {
		super(app);
		this.title = opts.title;
		this.value = opts.value ?? "";
		this.placeholder = opts.placeholder ?? "";
		this.minLength = opts.minLength ?? 1;
		this.onSubmit = opts.onSubmit;
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.title);
		contentEl.empty();

		const submit = () => {
			const v = this.value.trim();
			if (v.length < this.minLength) return;
			this.close();
			this.onSubmit(v);
		};

		new Setting(contentEl).setName("Nombre").addText((text) => {
			text.setPlaceholder(this.placeholder)
				.setValue(this.value)
				.onChange((v) => {
					this.value = v;
				});
			submitOnEnter(text, submit);
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Crear").setCta().onClick(submit)
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Modal con un campo de texto y un desplegable. */
export class TextAndSelectModal extends Modal {
	private title: string;
	private textValue: string;
	private textPlaceholder: string;
	private textLabel: string;
	private selectValue: string;
	private selectOptions: { value: string; label: string }[];
	private selectLabel: string;
	private onSubmit: (text: string, select: string) => void;

	constructor(
		app: App,
		opts: {
			title: string;
			textLabel: string;
			textPlaceholder?: string;
			textValue?: string;
			selectLabel: string;
			selectOptions: { value: string; label: string }[];
			selectValue?: string;
			onSubmit: (text: string, select: string) => void;
		}
	) {
		super(app);
		this.title = opts.title;
		this.textValue = opts.textValue ?? "";
		this.textPlaceholder = opts.textPlaceholder ?? "";
		this.textLabel = opts.textLabel;
		this.selectValue = opts.selectValue ?? opts.selectOptions[0]?.value ?? "";
		this.selectOptions = opts.selectOptions;
		this.selectLabel = opts.selectLabel;
		this.onSubmit = opts.onSubmit;
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.title);
		contentEl.empty();

		const submit = () => {
			const v = this.textValue.trim();
			if (!v) return;
			this.close();
			this.onSubmit(v, this.selectValue);
		};

		new Setting(contentEl).setName(this.textLabel).addText((text) => {
			text.setPlaceholder(this.textPlaceholder)
				.setValue(this.textValue)
				.onChange((v) => {
					this.textValue = v;
				});
			submitOnEnter(text, submit);
		});

		new Setting(contentEl).setName(this.selectLabel).addDropdown((dd) => {
			for (const opt of this.selectOptions) dd.addOption(opt.value, opt.label);
			dd.setValue(this.selectValue).onChange((v) => {
				this.selectValue = v;
			});
		});

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Crear").setCta().onClick(submit)
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ScenePickerModal extends FuzzySuggestModal<Scene> {
	constructor(app: App, private scenes: Scene[], private onPick: (scene: Scene) => void) {
		super(app);
		this.setPlaceholder("Elige una escena para abrirla…");
	}

	getItems(): Scene[] {
		return this.scenes;
	}

	getItemText(scene: Scene): string {
		return `${scene.chapter} / ${scene.title}`;
	}

	getItemDescription(scene: Scene): string {
		return `${num(scene.words)} palabras · ${scene.pov || "sin POV"}`;
	}

	onChooseItem(scene: Scene): void {
		this.onPick(scene);
	}
}

export class NamePickerModal extends FuzzySuggestModal<{ name: string; path: string; hint: string }> {
	constructor(
		app: App,
		private items: { name: string; path: string; hint: string }[],
		label: string,
		private onPick: (item: { name: string; path: string; hint: string }) => void
	) {
		super(app);
		this.setPlaceholder(`${label}…`);
	}

	getItems(): { name: string; path: string; hint: string }[] {
		return this.items;
	}

	getItemText(item: { name: string; path: string; hint: string }): string {
		return item.name;
	}

	getItemDescription(item: { name: string; path: string; hint: string }): string {
		return item.hint;
	}

	onChooseItem(item: { name: string; path: string; hint: string }): void {
		this.onPick(item);
	}
}

/** Modal de selección múltiple con checkboxes. */
export class MultiPickerModal extends Modal {
	private checked: Set<string>;
	private title: string;
	private items: { name: string; hint: string; selected: boolean }[];
	private onSubmit: (names: string[]) => void;

	constructor(
		app: App,
		opts: {
			title: string;
			items: { name: string; hint: string; selected: boolean }[];
			onSubmit: (names: string[]) => void;
		}
	) {
		super(app);
		this.title = opts.title;
		this.items = opts.items;
		this.checked = new Set(opts.items.filter((i) => i.selected).map((i) => i.name));
		this.onSubmit = opts.onSubmit;
	}

	onOpen(): void {
		const { contentEl, titleEl } = this;
		titleEl.setText(this.title);
		contentEl.empty();

		if (this.items.length === 0) {
			new Setting(contentEl).setDesc("Todavía no hay fichas de personajes en este libro.");
		}

		for (const item of this.items) {
			new Setting(contentEl).setName(item.name).setDesc(item.hint).addToggle((tg) =>
				tg.setValue(this.checked.has(item.name)).onChange((on) => {
					if (on) this.checked.add(item.name);
					else this.checked.delete(item.name);
				})
			);
		}

		new Setting(contentEl).addButton((b) =>
			b.setButtonText("Guardar").setCta().onClick(() => {
				this.close();
				this.onSubmit([...this.checked]);
			})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function roleOptions(): { value: string; label: string }[] {
	return (Object.keys(ROLE_LABELS) as CharacterRole[]).map((r) => ({
		value: r,
		label: ROLE_LABELS[r],
	}));
}

export function worldKindOptions(): { value: string; label: string }[] {
	const kinds: WorldEntry["kind"][] = [
		"Lugar",
		"Región",
		"Objeto",
		"Facción",
		"Concepto",
		"Evento",
		"Otro",
	];
	return kinds.map((k) => ({ value: k, label: k }));
}
