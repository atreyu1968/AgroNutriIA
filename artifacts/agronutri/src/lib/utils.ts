import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

export function formatDateTime(dateString: string) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatNumber(num: number | null | undefined, decimals = 2) {
  if (num === null || num === undefined) return "-";
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(num);
}

/**
 * CE: la interfaz trabaja siempre en µS/cm; la API y los cálculos en dS/m.
 * Los valores guardados pueden venir en cualquiera de las dos unidades
 * (heurística: > 10 ⇒ µS/cm).
 */
export const ecToUs = (v: number): number => Math.round(v > 10 ? v : v * 1000);
export const ecToDs = (v: number): number => (v > 10 ? v / 1000 : v);
