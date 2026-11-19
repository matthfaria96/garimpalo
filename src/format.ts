import { getCurrency, getLang, L, locale } from "./i18n";

let cache: { key: string; nf: Intl.NumberFormat } | null = null;
function moneyFormat(): Intl.NumberFormat {
  const key = `${locale()}|${getCurrency()}`;
  if (cache?.key !== key) {
    cache = { key, nf: new Intl.NumberFormat(locale(), { style: "currency", currency: getCurrency() }) };
  }
  return cache.nf;
}

/** centavos -> "R$ 25,00" / "$25.00" (na moeda escolhida) */
export function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return moneyFormat().format(cents / 100).replace(/ /g, " ");
}

/** Símbolo e número separados (para o símbolo pequeno ao lado do número grande). */
export function moneyParts(cents: number): { cur: string; num: string } {
  const parts = moneyFormat().formatToParts(cents / 100);
  const cur = parts.find((p) => p.type === "currency")?.value ?? "";
  const num = parts
    .filter((p) => p.type !== "currency" && p.type !== "literal")
    .map((p) => p.value)
    .join("");
  return { cur, num };
}

/** Símbolo da moeda: "R$", "$", "€". */
export const currencySymbol = () => moneyParts(0).cur;

/** Separador decimal do idioma atual. */
const decimalComma = () => getLang() !== "en";

/** "25", "25,9", "R$ 1.250,00", "25.50", "$1,250.00" -> centavos. Vazio -> null */
export function parseMoney(input: string): number | null {
  let s = input.replace(/[^\d,.-]/g, "").trim();
  if (!s) return null;
  if (!decimalComma()) {
    s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, "");
  } else if (/\.\d{3}$/.test(s)) {
    s = s.replace(".", ""); // "1.250" = mil duzentos e cinquenta
  }
  const n = Number(s);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** centavos -> "25,00" / "25.00" (para preencher campos) */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  const s = (cents / 100).toFixed(2);
  return decimalComma() ? s.replace(".", ",") : s;
}

/** Placeholder dos campos de dinheiro. */
export const zeroInput = () => (decimalComma() ? "0,00" : "0.00");

export function discountPercent(sale: number | null, promo: number | null): number | null {
  if (sale == null || promo == null || sale <= 0 || promo >= sale) return null;
  return Math.round((1 - promo / sale) * 100);
}

/** Preço efetivo (promo se houver) */
export function finalPrice(sale: number | null, promo: number | null): number | null {
  return promo ?? sale;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!(d && m && y)) return iso;
  return getLang() === "en" ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
}

export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Busca sem acento e sem diferenciar maiúsculas */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = (n / 1024 / 1024).toFixed(1);
  return `${decimalComma() ? mb.replace(".", ",") : mb} MB`;
}

/** "2026-11-19T14:05:00" -> "19/11/2026 às 14:05" / "11/19/2026 at 14:05" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const time = iso.slice(11, 16);
  return time ? `${formatDate(iso)} ${L("às", "at")} ${time}` : formatDate(iso);
}

/** Resumo de uma venda/pedido no formato do WhatsApp (negrito com *). */
export function saleSummary(s: {
  buyer: string;
  contact?: string;
  notes: string;
  total: number;
  items: { name: string; quantity: number; unitPrice: number }[];
}): string {
  const head = s.buyer.trim() ? `*${L("Pedido de", "Order for")} ${s.buyer.trim()}*` : `*${L("Pedido", "Order")}*`;
  const lines = s.items.map((i) => {
    const sub = formatMoney(i.quantity * i.unitPrice);
    return i.quantity > 1
      ? `${i.quantity}× ${i.name} — ${sub} (${formatMoney(i.unitPrice)} ${L("cada", "each")})`
      : `1× ${i.name} — ${sub}`;
  });
  const sum = s.items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const adj = s.total - sum;
  const out = [head, "", ...lines, ""];
  if (adj !== 0) out.push(`${adj < 0 ? L("Desconto", "Discount") : L("Acréscimo", "Surcharge")}: ${formatMoney(Math.abs(adj))}`);
  out.push(`Total: *${formatMoney(s.total)}*`);
  if (s.notes.trim()) out.push("", `${L("Obs.", "Notes")}: ${s.notes.trim()}`);
  return out.join("\n");
}
