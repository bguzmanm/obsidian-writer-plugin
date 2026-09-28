/**
 * DOM mínimo para probar los helpers de src/ui/dom.ts fuera de Obsidian.
 * Sólo implementa lo que esos helpers tocan, pero lo implementa de verdad:
 * appendChild cuelga en el árbol, textContent concatena, y los listeners se
 * pueden disparar para comprobar que un botón hace algo al pulsarlo.
 */

class FakeClassList {
	constructor(el) {
		this.el = el;
	}
	add(...names) {
		const current = this.el.className ? this.el.className.split(/\s+/).filter(Boolean) : [];
		for (const n of names) if (!current.includes(n)) current.push(n);
		this.el.className = current.join(" ");
	}
	remove(name) {
		this.el.className = this.el.className
			.split(/\s+/)
			.filter((c) => c && c !== name)
			.join(" ");
	}
	contains(name) {
		return this.el.className.split(/\s+/).includes(name);
	}
}

class FakeElement {
	constructor(tag) {
		this.tagName = tag.toUpperCase();
		this.className = "";
		this.style = {};
		this.children = [];
		this.parent = null;
		this.attributes = {};
		this.listeners = new Map();
		this._text = "";
		this.classList = new FakeClassList(this);
	}

	get textContent() {
		if (this.children.length === 0) return this._text;
		return this._text + this.children.map((c) => c.textContent).join("");
	}

	set textContent(value) {
		this._text = value === undefined || value === null ? "" : String(value);
		this.children = [];
	}

	get value() {
		return this._value ?? "";
	}

	set value(v) {
		this._value = v;
	}

	setAttribute(name, value) {
		this.attributes[name] = value;
		if (name === "title") this.title = value;
	}

	getAttribute(name) {
		return name in this.attributes ? this.attributes[name] : null;
	}

	hasAttribute(name) {
		return name in this.attributes;
	}

	appendChild(child) {
		if (child.parent) child.parent.removeChild(child);
		child.parent = this;
		this.children.push(child);
		return child;
	}

	removeChild(child) {
		this.children = this.children.filter((c) => c !== child);
		child.parent = null;
		return child;
	}

	empty() {
		for (const c of this.children) c.parent = null;
		this.children = [];
		this._text = "";
	}

	addEventListener(type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(fn);
	}

	/** Dispara los listeners de un evento, como haría el navegador. */
	fire(type, props = {}) {
		const ev = {
			type,
			target: this,
			preventDefault() {},
			stopPropagation() {},
			...props,
		};
		let prevented = false;
		ev.preventDefault = () => {
			prevented = true;
		};
		for (const fn of this.listeners.get(type) ?? []) fn(ev);
		return { prevented };
	}

	/** Todos los nodos del subárbol, en profundidad. */
	walk() {
		const out = [this];
		for (const c of this.children) out.push(...c.walk());
		return out;
	}
}

export function createFakeDocument() {
	return {
		createElement(tag) {
			return new FakeElement(tag);
		},
		createTextNode(text) {
			const el = new FakeElement("#text");
			el.textContent = text;
			return el;
		},
		body: new FakeElement("body"),
	};
}

export { FakeElement };
