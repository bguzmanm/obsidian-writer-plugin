import { DayStat } from "../types";

export function formatDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function todayKey(d = new Date()): string {
	return formatDate(d);
}

export function parseDate(key: string): Date {
	const [y, m, d] = key.split("-").map(Number);
	return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Lunes de la semana en curso, en formato YYYY-MM-DD. */
export function startOfWeek(d: Date): string {
	const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	const shift = (copy.getDay() + 6) % 7;
	copy.setDate(copy.getDate() - shift);
	return formatDate(copy);
}

export function addDays(key: string, n: number): string {
	const d = parseDate(key);
	d.setDate(d.getDate() + n);
	return formatDate(d);
}

function isNextDay(a: string, b: string): boolean {
	return addDays(a, 1) === b;
}

function countBack(active: Set<string>, from: string): number {
	let n = 0;
	let cursor = from;
	while (active.has(cursor)) {
		n += 1;
		cursor = addDays(cursor, -1);
		if (n > 100000) break;
	}
	return n;
}

/**
 * Racha de días consecutivos con al menos una palabra escrita.
 * La racha sigue viva si hoy todavía no se ha escrito, siempre que ayer sí.
 */
export function computeStreaks(daily: DayStat[], today = todayKey()): { streak: number; bestStreak: number } {
	if (daily.length === 0) return { streak: 0, bestStreak: 0 };

	const active = new Set(daily.filter((d) => d.words > 0).map((d) => d.date));
	if (active.size === 0) return { streak: 0, bestStreak: 0 };

	const sorted = Array.from(active).sort();
	let best = 1;
	let run = 1;
	for (let i = 1; i < sorted.length; i += 1) {
		if (isNextDay(sorted[i - 1], sorted[i])) {
			run += 1;
			best = Math.max(best, run);
		} else {
			run = 1;
		}
	}

	const yesterday = addDays(today, -1);
	const streak = active.has(today)
		? countBack(active, today)
		: active.has(yesterday)
			? countBack(active, yesterday)
			: 0;

	return { streak, bestStreak: best };
}
