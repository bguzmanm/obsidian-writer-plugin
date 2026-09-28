import { countWords, countWordsInText, firstMeaningfulLine, estimateMinutes } from "../src/stats/count";
import { addDays, computeStreaks, formatDate, startOfWeek, todayKey } from "../src/stats/dates";
import type { DayStat } from "../src/types";

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

// ---------------------------------------------------------------- conteo

section("conteo de palabras");

check(
	"palabras simple en español",
	countWords("El perro corre hacia el parque.").words,
	6
);

check(
	"acentos y ñ cuentan como una palabra",
	countWords("El corazón de Ángel mañana cantaría.").words,
	6
);

check(
	"no cuenta los encabezados por defecto",
	countWords("# Título de la nota\n\nCuerpo del texto.").words,
	3
);

check(
	"sí cuenta los encabezados si se pide",
	countWords("# Título de la nota\n\nCuerpo del texto.", { countHeadings: true }).words,
	7
);

check(
	"la cursiva no parte palabras",
	countWords("Era *muy* raro y esto `no cuenta`.").words,
	5
);

check(
	"los enlaces cuentan su texto, no la url",
	countWords("Mira [la documentación oficial](https://ejemplo.com/muy/larga/una/url).").words,
	4
);

check(
	"el código en línea no cuenta",
	countWords("Usa `console.log()` para imprimir.").words,
	3
);

check(
	"las tablas no cuentan",
	countWords("| Inicio | Fin |\n| --- | --- |\n| 10:00 | 11:00 |").words,
	0
);

check(
	"los bloques de código no cuentan",
	countWords("Antes.\n\n```js\nconst x = 1; // palabra clave\nfunction hola() {}\n```\n\nDespués.").words,
	2
);

check(
	"varios bloques de código seguidos",
	countWords("```\nuno dos\n```\ntexto\n```\ntres cuatro\n```\n").words,
	1
);

check(
	"un bloque sin cerrar se ignoran hasta el final",
	countWords("Antes.\n\n```\nesto no cuenta\ntampoco esto\n").words,
	1
);

check(
	"los números no cuentan por defecto",
	countWords("Había 3 gatos y 2 perros.").words,
	4
);

check(
	"los números cuentan si se pide",
	countWords("Había 3 gatos y 2 perros.", { countNumbers: true }).words,
	6
);

check(
	"el apóstrofo interno no parte la palabra",
	countWords("l'Hôpital d'Aix-en-Provence").words,
	2
);

check(
	"el apóstrofo final no crea una palabra suelta",
	countWords("los dias' buenos").words,
	3
);

check(
	"las comillas y signos no cuentan como palabras",
	countWords("«¿Cómo estás?» —muy bien, gracias.").words,
	5
);

check("texto vacío", countWords("").words, 0);

check("sólo espacios", countWords("   \n\n  \n").words, 0);

check("conteo de caracteres ignora espacios", countWords("hola mundo").chars, 9);

check(
	"una palabra seguida de coma cuenta como una",
	countWords("uno, dos; tres: cuatro.").words,
	4
);

check("texto plano sin markdown", countWordsInText("uno dos tres cuatro cinco"), 5);

check("elipsis", countWords("Y entonces… nada.").words, 3);

check(
	"una nota de escena cuenta sólo su prosa, no su estructura",
	countWords(
		"# La estación\n\n> **POV:** Ana\n\n## Sinopsis\n\nAna llega tarde.\n\n## Escena\n\nLa lluvia no paraba desde la madrugada.\n"
	).words,
	12
);

check(
	"con frontmatter delante el conteo lo incluye: por eso bodyOf va antes",
	countWords(
		"---\nbw_type: scene\nbw_status: draft\n---\n\n# La estación\n\nLa lluvia no paraba.\n"
	).words,
	10
);

// --------------------------------------------------------------- helpers

section("utilidades de texto");

check(
	"la primera línea da el título de un encabezado",
	firstMeaningfulLine("# Título\n\nLa primera frase real."),
	"Título"
);

check("texto sin encabezado", firstMeaningfulLine("Directo al grano."), "Directo al grano.");

check("salta líneas vacías", firstMeaningfulLine("\n\n\nAhora sí."), "Ahora sí.");

check("texto vacío", firstMeaningfulLine("\n\n  \n"), "");

check("estimación de minutos", estimateMinutes(500), 2);
check("estimación de minutos, cero", estimateMinutes(0), 0);
check("estimación de minutos, mínimo", estimateMinutes(10), 1);

// ---------------------------------------------------------------- fechas

section("fechas");

check("formato de fecha", formatDate(new Date(2026, 8, 27)), "2026-09-27");
check("mes con cero a la izquierda", formatDate(new Date(2026, 0, 5)), "2026-01-05");
check("saltar de mes", addDays("2026-01-31", 1), "2026-02-01");
check("año bisiesto", addDays("2028-02-28", 1), "2028-02-29");
check("año bisiesto, no bisiesto", addDays("2026-02-28", 1), "2026-03-01");
check("cruzar el año", addDays("2026-12-31", 1), "2027-01-01");
check("semana empieza en lunes", startOfWeek(new Date(2026, 8, 27)), "2026-09-21");
check("domingo pertenece a la semana anterior", startOfWeek(new Date(2026, 8, 27, 23)), "2026-09-21");
check("lunes da sí mismo", startOfWeek(new Date(2026, 8, 21)), "2026-09-21");
check("hoy es hoy", todayKey(new Date(2026, 8, 27)), "2026-09-27");

// --------------------------------------------------------------- rachas

section("rachas");

const day = (date: string, words: number): DayStat => ({ date, words, minutes: 0 });

check("sin días, sin racha", computeStreaks([], "2026-09-27"), { streak: 0, bestStreak: 0 });

check(
	"días con cero palabras no cuentan",
	computeStreaks([day("2026-09-25", 0), day("2026-09-26", 0)], "2026-09-27"),
	{ streak: 0, bestStreak: 0 }
);

check(
	"tres días seguidos terminando hoy",
	computeStreaks(
		[day("2026-09-25", 100), day("2026-09-26", 200), day("2026-09-27", 300)],
		"2026-09-27"
	),
	{ streak: 3, bestStreak: 3 }
);

check(
	"la racha sobrevive si hoy aún no se ha escrito",
	computeStreaks([day("2026-09-25", 100), day("2026-09-26", 200)], "2026-09-27"),
	{ streak: 2, bestStreak: 2 }
);

check(
	"la racha muere si faltan dos días",
	computeStreaks([day("2026-09-25", 100)], "2026-09-27"),
	{ streak: 0, bestStreak: 1 }
);

check(
	"un hueco corta la racha actual",
	computeStreaks(
		[
			day("2026-09-10", 100),
			day("2026-09-11", 100),
			day("2026-09-12", 100),
			day("2026-09-14", 100),
			day("2026-09-15", 100),
			day("2026-09-16", 100),
			day("2026-09-26", 100),
			day("2026-09-27", 100),
		],
		"2026-09-27"
	),
	{ streak: 2, bestStreak: 3 }
);

check(
	"cuarenta días seguidos dan una racha de cuarenta",
	computeStreaks(
		Array.from({ length: 40 }, (_, i) => day(addDays("2026-08-19", i), 100)),
		"2026-09-27"
	),
	{ streak: 40, bestStreak: 40 }
);

check(
	"una racha larga anterior y otra actual",
	computeStreaks(
		[
			day("2026-09-01", 100),
			day("2026-09-02", 100),
			day("2026-09-03", 100),
			day("2026-09-04", 100),
			day("2026-09-25", 100),
			day("2026-09-26", 100),
			day("2026-09-27", 100),
		],
		"2026-09-27"
	),
	{ streak: 3, bestStreak: 4 }
);

check(
	"cruza el cambio de año",
	computeStreaks(
		[day("2026-12-30", 100), day("2026-12-31", 100), day("2027-01-01", 100)],
		"2027-01-01"
	),
	{ streak: 3, bestStreak: 3 }
);

check(
	"entradas desordenadas",
	computeStreaks([day("2026-09-27", 10), day("2026-09-25", 10), day("2026-09-26", 10)], "2026-09-27"),
	{ streak: 3, bestStreak: 3 }
);

// --------------------------------------------------------------- resumen

console.log(`\n${"=".repeat(50)}`);
console.log(`${pass} correctas, ${fail} fallidas`);
process.exit(fail === 0 ? 0 : 1);
