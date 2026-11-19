/**
 * Idioma e moeda do app. Os textos ficam lado a lado no código: L("Salvar", "Save").
 * Trocar idioma/moeda remonta a interface (App usa `usePrefs()` como key).
 */
import { useSyncExternalStore } from "react";

export type Lang = "pt" | "en";
export type Currency = "BRL" | "USD" | "EUR";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "pt", label: "Português" },
  { id: "en", label: "English" },
];

export const CURRENCIES: { id: Currency; label: string }[] = [
  { id: "BRL", label: "R$ · Real" },
  { id: "USD", label: "US$ · Dollar" },
  { id: "EUR", label: "€ · Euro" },
];

const systemPt = () => /^pt\b/i.test(navigator.language || "");

let lang: Lang = systemPt() ? "pt" : "en";
let currency: Currency = systemPt() ? "BRL" : "USD";
let version = 0;
const listeners = new Set<() => void>();

export const getLang = () => lang;
export const getCurrency = () => currency;
/** Locale usado em datas, números e ordenação. */
export const locale = () => (lang === "en" ? "en-US" : "pt-BR");

/** Aplica idioma/moeda vindos das configurações salvas (valores inválidos são ignorados). */
export function applyPrefs(p: { language?: unknown; currency?: unknown }) {
  if (p.language === "pt" || p.language === "en") lang = p.language;
  if (p.currency === "BRL" || p.currency === "USD" || p.currency === "EUR") currency = p.currency;
  document.documentElement.lang = locale();
  version++;
  listeners.forEach((f) => f());
}

/** Texto no idioma atual. */
export const L = (pt: string, en: string) => (lang === "en" ? en : pt);

/** Singular/plural no idioma atual: P(n, ["modelo", "modelos"], ["model", "models"]) → "3 modelos". */
export function P(n: number, pt: [string, string], en: [string, string]) {
  const [one, many] = lang === "en" ? en : pt;
  return `${n} ${n === 1 ? one : many}`;
}

/** Re-renderiza quem usa quando idioma ou moeda mudam. */
export function usePrefs(): string {
  const v = useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => version,
  );
  return `${lang}-${currency}-${v}`;
}
