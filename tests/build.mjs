import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = path.join(here, "obsidian-stub.js");

const common = {
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node20",
	logLevel: "warning",
};

await esbuild.build({
	...common,
	entryPoints: [path.join(here, "logic.test.ts")],
	outfile: "/tmp/bw-test/logic.cjs",
});

// el test de esquema necesita obsidian, así que lo sustituimos por el stub
await esbuild.build({
	...common,
	entryPoints: [path.join(here, "schema.test.ts")],
	outfile: "/tmp/bw-test/schema.cjs",
	alias: { obsidian: stub },
});

// el flujo completo simula un vault con la caché de metadatos retrasada.
// usa await de nivel superior, así que se compila como ESM
await esbuild.build({
	...common,
	format: "esm",
	entryPoints: [path.join(here, "flow.test.ts")],
	outfile: "/tmp/bw-test/flow.mjs",
	alias: { obsidian: stub },
});

// los helpers de UI usan document.createElement, que aquí lo aporta dom-stub.
// usa await de nivel superior, así que se compila como ESM
await esbuild.build({
	...common,
	format: "esm",
	entryPoints: [path.join(here, "dom.test.ts")],
	outfile: "/tmp/bw-test/dom.mjs",
	alias: { obsidian: stub },
});

console.log("tests compilados");
