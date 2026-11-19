const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return brl.format(cents / 100).replace(/ /g, " ");
}

/** "25", "25,9", "R$ 1.250,00", "25.50" -> centavos. Vazio -> null */
export function parseBRL(input: string): number | null {
  let s = input.replace(/[^\d,.-]/g, "").trim();
  if (!s) return null;
  if (s.includes(",")) {
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

/** centavos -> "25,00" (para preencher campos) */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

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
  return d && m && y ? `${d}/${m}/${y}` : iso;
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
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** "2026-11-19T14:05:00" -> "19/11/2026 às 14:05" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const time = iso.slice(11, 16);
  return time ? `${formatDate(iso)} às ${time}` : formatDate(iso);
}

/** Resumo de uma venda/pedido no formato do WhatsApp (negrito com *). */
export function saleSummary(s: {
  buyer: string;
  contact?: string;
  notes: string;
  total: number;
  items: { name: string; quantity: number; unitPrice: number }[];
}): string {
  const head = s.buyer.trim() ? `*Pedido de ${s.buyer.trim()}*` : "*Pedido*";
  const lines = s.items.map((i) => {
    const sub = formatBRL(i.quantity * i.unitPrice);
    return i.quantity > 1
      ? `${i.quantity}× ${i.name} — ${sub} (${formatBRL(i.unitPrice)} cada)`
      : `1× ${i.name} — ${sub}`;
  });
  const sum = s.items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const adj = s.total - sum;
  const out = [head, "", ...lines, ""];
  if (adj !== 0) out.push(`${adj < 0 ? "Desconto" : "Acréscimo"}: ${formatBRL(Math.abs(adj))}`);
  out.push(`Total: *${formatBRL(s.total)}*`);
  if (s.notes.trim()) out.push("", `Obs.: ${s.notes.trim()}`);
  return out.join("\n");
}
