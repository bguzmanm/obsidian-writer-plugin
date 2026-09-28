import {
	bodyOf,
	noteTitle,
	itemType,
	isType,
	fmString,
	fmNumber,
	belongsTo,
	frontMatterOf,
	noteView,
} from "../src/vault/schema";
import { sanitizeName, pad, uniquePath } from "../src/vault/structure";
import { sumRows } from "../src/stats/sessions";

/**
 * Un TFile de mentira con el frontmatter ya parseado, que es como lo ve el
 * código en runtime.
 */
function fakeFile(basename: string, front: Record<string, unknown>) {
	return { basename, getFrontMatter: () => front } as never;
}

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		pass += 1;
	} else {
		fail += 1;
		console.log(`  FALLO  ${name}\n         esperado: ${e}\n         obtenido: ${a}`);
	}
}

function section(name: string): void {
	console.log(`\n${name}`);
}

const NOTE = [
	"---",
	"bw_type: scene",
	"bw_book: Mi Libro",
	"bw_chapter: Capítulo 1",
	"bw_order: 2",
	"bw_status: draft",
	"---",
	"",
	"# La estación",
	"",
	"## Sinopsis",
	"",
	"Ana llega tarde y no se atreve a entrar.",
	"",
	"## Escena",
	"",
	"Texto de verdad aquí.",
	"",
	"## Notas",
	"",
	"Revisar el ritmo.",
].join("\n");

// ------------------------------------------------------------------ bodyOf

section("extracción del cuerpo");

check(
	"saca el cuerpo sin el frontmatter",
	bodyOf(NOTE),
	["", "# La estación", "", "## Sinopsis", "", "Ana llega tarde y no se atreve a entrar.", "", "## Escena", "", "Texto de verdad aquí.", "", "## Notas", "", "Revisar el ritmo."].join("\n")
);

check("una nota sin frontmatter pasa intacta", bodyOf("# Simple\n\ntexto"), "# Simple\n\ntexto");

check("frontmatter con guiones en los valores", bodyOf("---\nbw_book: Mi-Libro\n---\ntexto"), "texto");

check("el frontmatter cerrado no se cuela en el cuerpo", bodyOf(NOTE).includes("bw_type"), false);

check("nota vacía", bodyOf(""), "");

// -------------------------------------------------------------- noteTitle

section("títulos");

const file = fakeFile("La estación", {});

check("usa el encabezado si existe", noteTitle(file, NOTE), "La estación");

check("usa el nombre del archivo si no hay encabezado", noteTitle(file, "texto suelto"), "La estación");

check("encabezado de nivel 3", noteTitle(file, "### Sub\n\ntexto"), "Sub");

// ------------------------------------------------------------- frontmatter

section("lectura del frontmatter");

const scene = fakeFile("01 - Escena", {
	bw_type: "scene",
	bw_book: "Mi Libro",
	bw_chapter: "Capítulo 1",
	bw_order: 2,
	bw_status: "revision",
});

check("lee el tipo", itemType(scene), "scene");
check("comprueba el tipo", isType(scene, "scene"), true);
check("rechaza otro tipo", isType(scene, "character"), false);
check("lee una cadena", fmString(scene, "bw_book"), "Mi Libro");
check("lee un número", fmNumber(scene, "bw_order"), 2);
check("cadena ausente con valor por defecto", fmString(scene, "bw_pov", "—"), "—");
check("número ausente con valor por defecto", fmNumber(scene, "bw_goal", 500), 500);

const noFm = fakeFile("Normal", {});
check("nota sin frontmatter no es un item", itemType(noFm), "");
check("una nota sin bw_book pertenece a cualquier libro", belongsTo(noFm, "Mi Libro"), true);
check("una nota con bw_book sólo pertenece a su libro", belongsTo(scene, "Otro"), false);
check("y sí al suyo", belongsTo(scene, "Mi Libro"), true);

// ------------------------------------------------------------------ rutas

section("rutas");
check("quita caracteres prohibidos", sanitizeName("Capítulo 1: el viaje /回家?"), "Capítulo 1 el viaje 回家");

check("colapsa espacios", sanitizeName("a    b"), "a b");

check("recorta los bordes", sanitizeName("  borde  "), "borde");

check("rellena con ceros", pad(1), "01");
check("rellena con ceros, dos cifras", pad(12), "12");
check("rellena con ceros, tres cifras", pad(7, 3), "007");
check("nunca devuelve 0", pad(0), "01");

// Vault mínimo para probar uniquePath
function fakeVault(existing: string[]) {
	return { getAbstractFileByPath: (p: string) => (existing.includes(p) ? true : null) } as never;
}

check("una ruta libre se queda como está", uniquePath(fakeVault([]), "Libros/A.md"), "Libros/A.md");
check(
	"una ruta ocupada recibe un sufijo",
	uniquePath(fakeVault(["Libros/A.md"]), "Libros/A.md"),
	"Libros/A 2.md"
);
check(
	"y un segundo sufijo si también está ocupado",
	uniquePath(fakeVault(["Libros/A.md", "Libros/A 2.md"]), "Libros/A.md"),
	"Libros/A 3.md"
);
check(
	"funciona con carpetas también",
	uniquePath(fakeVault(["Libros/A"]), "Libros/A"),
	"Libros/A 2"
);

// ------------------------------------------------- acumulación de sesiones

section("acumulación de sesiones");

const EMPTY_LOG = [
	"# 2026-09-27",
	"",
	"## Sesiones",
	"",
	"| Inicio | Fin | Minutos | Palabras | Notas |",
	"| --- | --- | --- | --- | --- |",
	"",
	"## Notas del día",
].join("\n");

check("un log recién creado no suma nada", sumRows(EMPTY_LOG), { words: 0, minutes: 0, sessions: 0 });

const withRows = [
	EMPTY_LOG.split("\n")[0],
	"",
	"## Sesiones",
	"",
	"| Inicio | Fin | Minutos | Palabras | Notas |",
	"| --- | --- | --- | --- | --- |",
	"| 09:12 | 09:47 | 35 | 420 | +2500 car. |",
	"| 21:03 | 21:38 | 35 | 512 | +3100 car. |",
	"",
].join("\n");

check("suma las filas de la tabla", sumRows(withRows), { words: 932, minutes: 70, sessions: 2 });

check(
	"ignora la cabecera y el separador",
	sumRows("| Inicio | Fin | Minutos | Palabras | Notas |\n| --- | --- | --- | --- | --- |"),
	{ words: 0, minutes: 0, sessions: 0 }
);

check(
	"ignora las tablas de otras secciones",
	sumRows("| Inicio | Fin |\n| --- | --- |\n| 10:00 | 11:00 |"),
	{ words: 0, minutes: 0, sessions: 0 }
);

check(
	"la cabecera de la nota de recuento no se confunde con una sesión",
	sumRows("| Capítulo | Palabras |\n| --- | --- |\n| Uno | 1200 |"),
	{ words: 0, minutes: 0, sessions: 0 }
);

check(
	"celdas con guiones cuentan como cero, no como NaN",
	sumRows("| 09:12 | 09:47 | — | — | +0 car. |"),
	{ words: 0, minutes: 0, sessions: 1 }
);

// ------------------------------------- frontmatter recién escrito (sin caché)

section("frontmatter recién creado, antes de que Obsidian lo cachee");

/**
 * Reproduce el fallo que reportaba el usuario: al crear un capítulo, el archivo
 * ya está en el vault, pero la caché de metadatos todavía no lo conoce. Estos
 * archivos devuelven `{}` desde getFrontMatter(), que es lo que hace Obsidian
 * durante esa ventana.
 */
function freshFile(path: string, source: string) {
	return { path, basename: path.split("/").pop() ?? path, getFrontMatter: () => ({}) } as never;
}

const freshScene = [
	"---",
	"bw_type: scene",
	"bw_book: Mi Libro",
	"bw_chapter: Capítulo 1",
	"bw_order: 1",
	"bw_status: draft",
	"---",
	"",
	"# Escena 1",
].join("\n");

check("frontMatterOf ve el tipo", frontMatterOf(freshScene).bw_type, "scene");
check("ve el libro", frontMatterOf(freshScene).bw_book, "Mi Libro");
check("ve el capítulo", frontMatterOf(freshScene).bw_chapter, "Capítulo 1");
check("convierte el orden a número", frontMatterOf(freshScene).bw_order, 1);
check("no inventa claves que no están", "bw_pov" in frontMatterOf(freshScene), false);
check("una nota sin frontmatter da vacío", frontMatterOf("# Sola"), {});

const sceneView = noteView(freshFile("Libros/Mi Libro/Manuscrito/01 - Capítulo 1/Escena 1.md", freshScene), freshScene);
check("isType funciona sin depender de la caché", isType(sceneView, "scene"), true);
check("fmString lee el capítulo recién creado", fmString(sceneView, "bw_chapter"), "Capítulo 1");
check("fmNumber lee el orden recién creado", fmNumber(sceneView, "bw_order"), 1);

// el índice del manuscrito es el caso que fallaba al crear un capítulo
const freshIndex = [
	"---",
	"bw_type: chapter",
	"bw_book: Mi Libro",
	"bw_chapters:",
	"  - title: Capítulo 1",
	"    folderName: 01 - Capítulo 1",
	"    order: 1",
	"---",
	"",
	"# Manuscrito",
].join("\n");

const indexFront = frontMatterOf(freshIndex);
check("lee la lista de capítulos del índice recién escrito", indexFront.bw_chapters, [
	{ title: "Capítulo 1", folderName: "01 - Capítulo 1", order: 1 },
]);
check("y el tipo del índice sigue siendo chapter", indexFront.bw_type, "chapter");

// ------------------------------------------------- frontmatter recién escrito (sin caché) continue

section("parser de frontmatter: formatos que escribe Obsidian");

// lista vacía: el libro se crea con bw_chapters: [] antes de tener capítulos
check(
	"lista inline vacía",
	frontMatterOf("---\nbw_type: chapter\nbw_chapters: []\n---\n# Índice").bw_chapters,
	[]
);

// varios capítulos en el índice (el caso real tras crear más de uno)
const multiChapters = [
	"---",
	"bw_type: chapter",
	"bw_book: Mi Libro",
	"bw_chapters:",
	"  - title: Capítulo 1",
	"    folderName: 01 - Capítulo 1",
	"    order: 1",
	"  - title: Capítulo 2",
	"    folderName: 02 - Capítulo 2",
	"    order: 2",
	"---",
	"",
	"# Manuscrito",
].join("\n");
check(
	"varios capítulos en bloque",
	frontMatterOf(multiChapters).bw_chapters,
	[
		{ title: "Capítulo 1", folderName: "01 - Capítulo 1", order: 1 },
		{ title: "Capítulo 2", folderName: "02 - Capítulo 2", order: 2 },
	]
);

// Obsidian escribe con comillas las cadenas que contienen caracteres especiales
const quoted = [
	"---",
	'bw_name: "Mi Libro"',
	"bw_pov: ''",
	"---",
	"",
	"# Nota",
].join("\n");
check("quita las comillas dobles", frontMatterOf(quoted).bw_name, "Mi Libro");
check("y las simples", frontMatterOf(quoted).bw_pov, "");

// valores numéricos y booleanos dentro de una lista en bloque
const typed = [
	"---",
	"bw_goal: 500",
	"bw_meta:",
	"  - nombre: A",
	"    activo: true",
	"    orden: 3",
	"---",
	"",
	"# Nota",
].join("\n");
check("escalar numérico", frontMatterOf(typed).bw_goal, 500);
check("booleano dentro de objeto", frontMatterOf(typed).bw_meta[0].activo, true);
check("número dentro de objeto", frontMatterOf(typed).bw_meta[0].orden, 3);

// lista inline de escalares
check(
	"lista inline de escalares",
	frontMatterOf("---\nbw_tags: [idea, draft]\n---\n# Nota").bw_tags,
	["idea", "draft"]
);

// -------------------------------------------------------------- resumen

console.log(`\n${"=".repeat(50)}`);
console.log(`${pass} correctas, ${fail} fallidas`);
process.exit(fail === 0 ? 0 : 1);
