#!/usr/bin/env node
/**
 * Despliega el plugin compilado en la carpeta de plugins del vault.
 *
 * Uso:
 *   node scripts/deploy.mjs              # compila y copia una vez
 *   node scripts/deploy.mjs --watch      # esbuild en watch + resincroniza al compilar
 *
 * La ruta del vault se lee de `.deploy-path` (ignorado por git) o de la
 * variable de entorno WRITER_VAULT.
 */
import { execSync, spawn } from "node:child_process";
import { cpSync, existsSync, readFileSync, watchFile } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["main.js", "styles.css", "manifest.json"];
const PLUGIN_DIR = ".obsidian/plugins/book-writer";

function vaultPath() {
	if (process.env.WRITER_VAULT) return process.env.WRITER_VAULT;
	const file = join(ROOT, ".deploy-path");
	if (existsSync(file)) return readFileSync(file, "utf8").trim();
	throw new Error(
		"No encuentro el vault: crea `.deploy-path` con su ruta o define WRITER_VAULT."
	);
}

function deploy() {
	const vault = vaultPath();
	const target = join(vault, PLUGIN_DIR);
	if (!existsSync(target)) throw new Error(`No existe ${target} (¿está abierto Obsidian?)`);
	for (const file of FILES) {
		const src = join(ROOT, file);
		if (!existsSync(src)) throw new Error(`Falta ${file}: ejecuta la compilación antes.`);
		cpSync(src, join(target, file));
	}
	console.log(`Deploy OK → ${target}`);
}

const watchMode = process.argv.includes("--watch");

if (watchMode) {
	console.log("esbuild en watch… Ctrl+C para salir");
	const proc = spawn("npm", ["run", "dev"], { cwd: ROOT, stdio: "inherit" });
	const sync = () => {
		try {
			deploy();
		} catch {
			/* la compilación puede estar a medias */
		}
	};
	for (const file of FILES) {
		const src = join(ROOT, file);
		if (existsSync(src)) watchFile(src, { interval: 300 }, sync);
	}
	sync();
	process.on("SIGINT", () => {
		proc.kill();
		process.exit(0);
	});
} else {
	execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
	deploy();
}