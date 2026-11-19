// Desenha as páginas do catálogo (flyer) num <canvas>.
// Ideia: a foto é a estrela. Texto grande e legível no celular, preço em destaque,
// uma cor forte para a promoção. Cada tema muda a personalidade (cabeçalho, tipografia,
// card, botão), não só as cores.
import type { Fit } from "../api";
import { discountPercent, formatBRL } from "../format";

export interface RenderItem {
  name: string;
  salePrice: number | null;
  promoPrice: number | null;
  image: HTMLImageElement | null;
  /** preencher o quadro ou foto inteira com fundo desfocado (nunca faixas brancas/pretas) */
  fit: Fit;
  /** número do item no catálogo (contínuo entre as páginas): o cliente pede "quero o 5" */
  number?: number;
}

export type CatalogTheme = "light" | "dark" | "vitrine" | "oferta" | "pista" | "colecionador" | "neon";

export interface RenderOptions {
  perPage: PerPage;
  title: string;
  subtitle: string;
  footer: string;
  /** número do WhatsApp (opcional), aparece no botão */
  phone?: string;
  theme: CatalogTheme;
}

const W = 1080; // largura lógica
const SCALE = 1.5; // saída final: 1620px de largura
const OSWALD = "Oswald"; // condensada: números grandes cabem no card
const INTER = "Inter Variable"; // nomes e textos (legível em tamanho pequeno)
const SERIF = "Playfair Display"; // elegante, para o tema Colecionador

interface FontSpec {
  family: string;
  weight: number;
}

interface Theme {
  id: CatalogTheme;
  name: string;
  hint: string;
  /** cores da miniatura no seletor */
  swatch: { bg: string; head: string; headKind: "stripe" | "band" | "none"; card: string; price: string; button: string };

  bg: string;
  /** brilhos de fundo (tema neon) */
  glows?: { x: number; y: number; r: number; color: string }[];

  header: "stripe" | "band" | "center";
  stripe?: [string, string];
  band?: [string, string];
  title: FontSpec & { size: number; upper: boolean; color: string; gradient?: [string, string]; glow?: string };
  ornament?: string; // cor das linhas ao lado do título centralizado
  subtitle: { kind: "bubble" | "pill" | "caps" | "text"; bg: string; ink: string };
  pageLabel: string;

  card: { bg: string; border: string | null; shadow: string; blur: number; radius: number; inset: number; photoBg: string };
  nameFont: FontSpec & { color: string };
  priceFont: FontSpec & { scale: number; color: string; promo: string; strike: string };
  muted: string;
  badge: { bg: string; ink: string; font: FontSpec };
  chip: { bg: string; ink: string };
  button: { fill: [string, string]; ink: string; icon: string; glow: string; border?: string; shine: boolean };
}

const WA_BUTTON: Theme["button"] = { fill: ["#2fdc73", "#1ebe5d"], ink: "#ffffff", icon: "#ffffff", glow: "rgba(37,211,102,0.45)", shine: true };

export const THEMES: Theme[] = [
  {
    // Cores oficiais do WhatsApp: fundo da conversa, balão verde, verde-azulado nos títulos.
    id: "light",
    name: "WhatsApp",
    hint: "Como a conversa do WhatsApp",
    swatch: { bg: "#efeae2", head: "#25d366", headKind: "stripe", card: "#ffffff", price: "#e5281e", button: "#25d366" },
    bg: "#efeae2",
    header: "stripe",
    stripe: ["#25d366", "#128c7e"],
    title: { family: OSWALD, weight: 700, size: 72, upper: true, color: "#075e54" },
    subtitle: { kind: "bubble", bg: "#d9fdd3", ink: "#111b21" },
    pageLabel: "#667781",
    card: { bg: "#ffffff", border: "#e3ddd2", shadow: "rgba(11,20,26,0.09)", blur: 28, radius: 1, inset: 0, photoBg: "#e9edef" },
    nameFont: { family: INTER, weight: 600, color: "#111b21" },
    priceFont: { family: OSWALD, weight: 700, scale: 1, color: "#111b21", promo: "#e5281e", strike: "#8696a0" },
    muted: "#667781",
    badge: { bg: "#e5281e", ink: "#ffffff", font: { family: OSWALD, weight: 700 } },
    chip: { bg: "rgba(7,94,84,0.88)", ink: "#ffffff" },
    button: WA_BUTTON,
  },
  {
    id: "dark",
    name: "WhatsApp escuro",
    hint: "O WhatsApp no modo escuro",
    swatch: { bg: "#0b141a", head: "#25d366", headKind: "stripe", card: "#202c33", price: "#ffd21f", button: "#25d366" },
    bg: "#0b141a",
    header: "stripe",
    stripe: ["#25d366", "#00a884"],
    title: { family: OSWALD, weight: 700, size: 72, upper: true, color: "#e9edef" },
    subtitle: { kind: "bubble", bg: "#005c4b", ink: "#e9edef" },
    pageLabel: "#8696a0",
    card: { bg: "#202c33", border: "#2a3942", shadow: "rgba(0,0,0,0)", blur: 0, radius: 1, inset: 0, photoBg: "#2a3942" },
    nameFont: { family: INTER, weight: 600, color: "#e9edef" },
    priceFont: { family: OSWALD, weight: 700, scale: 1, color: "#e9edef", promo: "#ffd21f", strike: "#667781" },
    muted: "#8696a0",
    badge: { bg: "#e5281e", ink: "#ffffff", font: { family: OSWALD, weight: 700 } },
    chip: { bg: "rgba(0,168,132,0.92)", ink: "#ffffff" },
    button: WA_BUTTON,
  },
  {
    // Vitrine de loja premium: cinza-claro, produto num "palco" dentro do card, tipografia limpa.
    id: "vitrine",
    name: "Vitrine",
    hint: "Limpo e sofisticado, de loja premium",
    swatch: { bg: "#f5f5f7", head: "#1d1d1f", headKind: "none", card: "#ffffff", price: "#1d1d1f", button: "#1d1d1f" },
    bg: "#f5f5f7",
    header: "center",
    title: { family: INTER, weight: 800, size: 70, upper: false, color: "#1d1d1f" },
    subtitle: { kind: "text", bg: "transparent", ink: "#6e6e73" },
    pageLabel: "#86868b",
    card: { bg: "#ffffff", border: null, shadow: "rgba(0,0,0,0.07)", blur: 34, radius: 1.15, inset: 0.55, photoBg: "#f0f0f2" },
    nameFont: { family: INTER, weight: 600, color: "#1d1d1f" },
    priceFont: { family: INTER, weight: 800, scale: 0.8, color: "#1d1d1f", promo: "#e3001b", strike: "#a1a1a6" },
    muted: "#86868b",
    badge: { bg: "#e3001b", ink: "#ffffff", font: { family: INTER, weight: 800 } },
    chip: { bg: "rgba(29,29,31,0.82)", ink: "#ffffff" },
    button: { fill: ["#2c2c2e", "#1d1d1f"], ink: "#ffffff", icon: "#25d366", glow: "rgba(0,0,0,0.25)", shine: false },
  },
  {
    // Black Friday: preto + amarelo é o par de maior contraste e o mais associado a "promoção".
    id: "oferta",
    name: "Oferta relâmpago",
    hint: "Preto e amarelo, urgência de Black Friday",
    swatch: { bg: "#0a0a0a", head: "#ffd400", headKind: "band", card: "#171717", price: "#ffd400", button: "#ffd400" },
    bg: "#0a0a0a",
    header: "band",
    band: ["#ffd400", "#ffc400"],
    title: { family: OSWALD, weight: 700, size: 82, upper: true, color: "#0a0a0a" },
    subtitle: { kind: "pill", bg: "#0a0a0a", ink: "#ffd400" },
    pageLabel: "rgba(10,10,10,0.6)",
    card: { bg: "#171717", border: "#262626", shadow: "rgba(0,0,0,0)", blur: 0, radius: 0.7, inset: 0, photoBg: "#222222" },
    nameFont: { family: INTER, weight: 600, color: "#f5f5f5" },
    priceFont: { family: OSWALD, weight: 700, scale: 1.04, color: "#ffffff", promo: "#ffd400", strike: "#7a7a7a" },
    muted: "#8a8a8a",
    badge: { bg: "#ffd400", ink: "#0a0a0a", font: { family: OSWALD, weight: 700 } },
    chip: { bg: "rgba(255,255,255,0.92)", ink: "#0a0a0a" },
    button: { fill: ["#ffdc2e", "#ffc800"], ink: "#0a0a0a", icon: "#0a0a0a", glow: "rgba(255,212,0,0.35)", shine: true },
  },
  {
    // Energia Hot Wheels: faixa laranja de pista, azul-marinho nos preços, vermelho na promoção.
    id: "pista",
    name: "Pista",
    hint: "Laranja vibrante, energia Hot Wheels",
    swatch: { bg: "#fff6ee", head: "#ff5a00", headKind: "band", card: "#ffffff", price: "#0a2e7a", button: "#25d366" },
    bg: "#fff6ee",
    header: "band",
    band: ["#ff7a00", "#ff3d00"],
    title: { family: OSWALD, weight: 700, size: 80, upper: true, color: "#ffffff" },
    subtitle: { kind: "pill", bg: "rgba(255,255,255,0.22)", ink: "#ffffff" },
    pageLabel: "rgba(255,255,255,0.85)",
    card: { bg: "#ffffff", border: "#ffe2cc", shadow: "rgba(255,90,0,0.12)", blur: 26, radius: 1, inset: 0, photoBg: "#fff0e4" },
    nameFont: { family: INTER, weight: 600, color: "#1a1a2e" },
    priceFont: { family: OSWALD, weight: 700, scale: 1, color: "#0a2e7a", promo: "#e5281e", strike: "#9aa3b5" },
    muted: "#8a8fa3",
    badge: { bg: "#e5281e", ink: "#ffffff", font: { family: OSWALD, weight: 700 } },
    chip: { bg: "#0a2e7a", ink: "#ffffff" },
    button: WA_BUTTON,
  },
  {
    // Peça de coleção: papel creme, serifa elegante, azul-marinho e dourado (como catálogo de leilão).
    id: "colecionador",
    name: "Colecionador",
    hint: "Creme, azul-marinho e dourado",
    swatch: { bg: "#f3ede2", head: "#b8924a", headKind: "none", card: "#fffcf6", price: "#1f2a44", button: "#1f2a44" },
    bg: "#f3ede2",
    header: "center",
    title: { family: SERIF, weight: 700, size: 76, upper: false, color: "#1f2a44" },
    ornament: "#b8924a",
    subtitle: { kind: "caps", bg: "transparent", ink: "#9a7a3c" },
    pageLabel: "#9a8c74",
    card: { bg: "#fffcf6", border: "#e3d7c1", shadow: "rgba(60,40,10,0.08)", blur: 24, radius: 0.55, inset: 0.5, photoBg: "#ece3d3" },
    nameFont: { family: INTER, weight: 500, color: "#2a2a2a" },
    priceFont: { family: SERIF, weight: 700, scale: 0.86, color: "#1f2a44", promo: "#a3201a", strike: "#a3967f" },
    muted: "#9a8c74",
    badge: { bg: "#b8924a", ink: "#ffffff", font: { family: INTER, weight: 700 } },
    chip: { bg: "#1f2a44", ink: "#f6efe2" },
    button: { fill: ["#2a3757", "#1c2640"], ink: "#f6efe2", icon: "#25d366", glow: "rgba(31,42,68,0.3)", border: "#b8924a", shine: false },
  },
  {
    // Noite gamer: fundo azul-noite com brilhos rosa e ciano, título em degradê.
    id: "neon",
    name: "Neon",
    hint: "Noite gamer, rosa e ciano",
    swatch: { bg: "#0d0b1e", head: "#ff4fd8", headKind: "none", card: "#18153a", price: "#ff4fd8", button: "#25d366" },
    bg: "#0d0b1e",
    glows: [
      { x: 0.05, y: 0.02, r: 0.7, color: "rgba(255,79,216,0.20)" },
      { x: 0.98, y: 0.55, r: 0.75, color: "rgba(94,231,255,0.14)" },
    ],
    header: "center",
    title: { family: OSWALD, weight: 700, size: 82, upper: true, color: "#ffffff", gradient: ["#ff4fd8", "#5ee7ff"], glow: "rgba(255,79,216,0.55)" },
    subtitle: { kind: "pill", bg: "rgba(94,231,255,0.12)", ink: "#bfefff" },
    pageLabel: "#8c86b8",
    card: { bg: "#18153a", border: "rgba(255,255,255,0.09)", shadow: "rgba(255,79,216,0.18)", blur: 30, radius: 1, inset: 0, photoBg: "#221e4a" },
    nameFont: { family: INTER, weight: 600, color: "#f1efff" },
    priceFont: { family: OSWALD, weight: 700, scale: 1, color: "#ffffff", promo: "#ff4fd8", strike: "#7d77a8" },
    muted: "#8c86b8",
    badge: { bg: "#ff4fd8", ink: "#ffffff", font: { family: OSWALD, weight: 700 } },
    chip: { bg: "#5ee7ff", ink: "#0d0b1e" },
    button: { ...WA_BUTTON, glow: "rgba(37,211,102,0.6)" },
  },
];

const themeById = (id: CatalogTheme) => THEMES.find((t) => t.id === id) ?? THEMES[0];

/** CSS de fonte para o canvas (sempre entre aspas: funciona com nomes com espaço). */
const font = (f: FontSpec, size: number) => `${f.weight} ${size}px "${f.family}"`;
const TEXT_FONT: FontSpec = { family: INTER, weight: 600 };

interface Metrics {
  cols: number;
  pad: number;
  gap: number;
  cardW: number;
  imgH: number;
  infoH: number;
  inner: number;
  radius: number;
  name: number;
  price: number;
  badge: number;
}

/** Quantos por página: 1 (1×1, destaque), 4 (2×2), 9 (3×3) ou 16 (4×4). */
export type PerPage = 1 | 4 | 9 | 16;
export const PER_PAGE_OPTIONS: PerPage[] = [1, 4, 9, 16];

/** Medidas de cada layout: quanto menos itens, maior a foto e o texto. */
const LAYOUTS: Record<PerPage, { cols: number; pad: number; gap: number; name: number; price: number; inner: number; radius: number; badge: number; nameGap: number }> = {
  1: { cols: 1, pad: 56, gap: 0, name: 50, price: 112, inner: 36, radius: 32, badge: 50, nameGap: 24 },
  4: { cols: 2, pad: 40, gap: 30, name: 36, price: 78, inner: 26, radius: 26, badge: 36, nameGap: 18 },
  9: { cols: 3, pad: 36, gap: 24, name: 29, price: 56, inner: 20, radius: 22, badge: 28, nameGap: 14 },
  16: { cols: 4, pad: 30, gap: 18, name: 23, price: 43, inner: 15, radius: 18, badge: 23, nameGap: 10 },
};

function metrics(perPage: PerPage, T: Theme): Metrics {
  const L = LAYOUTS[perPage] ?? LAYOUTS[9];
  const cardW = (W - L.pad * 2 - L.gap * (L.cols - 1)) / L.cols;
  return {
    cols: L.cols, pad: L.pad, gap: L.gap, cardW, imgH: (cardW * 4) / 3, inner: L.inner, radius: L.radius * T.card.radius,
    name: L.name, price: L.price, badge: L.badge,
    infoH: L.inner + L.name * 1.22 * 2 + L.nameGap + L.price * 0.8 + L.inner + L.price * 0.07,
  };
}

export async function ensureFonts() {
  await Promise.all([
    ...["500", "600", "700"].map((w) => document.fonts.load(`${w} 40px "${OSWALD}"`)),
    ...["500", "600", "700", "800"].map((w) => document.fonts.load(`${w} 40px "${INTER}"`)),
    ...["700"].map((w) => document.fonts.load(`${w} 40px "${SERIF}"`)),
  ]);
}

export function paginate<T>(items: T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages;
}

/** Espaçamento entre letras, quando o navegador suporta (fica normal se não suportar). */
function tracking(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
}

export function renderPage(
  items: RenderItem[],
  opts: RenderOptions,
  pageIndex: number,
  pageCount: number,
): HTMLCanvasElement {
  const T = themeById(opts.theme);
  const m = metrics(opts.perPage, T);
  const rows = Math.max(1, Math.ceil(items.length / m.cols));
  const rawTitle = opts.title.trim();
  const title = T.title.upper ? rawTitle.toUpperCase() : rawTitle;
  const sub = opts.subtitle.trim();
  // o ícone do WhatsApp substitui emojis do texto do botão (ficariam estranhos ao lado dele)
  const footer = opts.footer.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
  const phone = (opts.phone ?? "").trim();
  const hasButton = !!(footer || phone);
  const btnH = footer && phone ? 112 : 92;
  const pageLabel = pageCount > 1 ? `${pageIndex + 1}/${pageCount}` : "";

  const headH = headerHeight(T, !!title, !!sub);
  const footH = hasButton ? btnH + 76 : 44;
  const cardH = m.imgH + m.infoH;
  const H = headH + rows * cardH + (rows - 1) * m.gap + footH;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * SCALE);
  canvas.height = Math.round(H * SCALE);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, W, H);
  for (const g of T.glows ?? []) {
    const r = g.r * W;
    const rg = ctx.createRadialGradient(g.x * W, g.y * H, 0, g.x * W, g.y * H, r);
    rg.addColorStop(0, g.color);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }

  drawHeader(ctx, T, m, title, sub, pageLabel);

  items.forEach((item, i) => {
    const col = i % m.cols;
    const row = Math.floor(i / m.cols);
    drawCard(ctx, T, item, m.pad + col * (m.cardW + m.gap), headH + row * (cardH + m.gap), m);
  });

  // Rodapé: botão de WhatsApp chamando para a conversa
  if (hasButton) drawWhatsAppButton(ctx, T, m.pad, H - footH + (footH - btnH) / 2 + 6, W - m.pad * 2, btnH, footer, phone);
  return canvas;
}

const STRIPE = 12;

function headerHeight(T: Theme, title: boolean, sub: boolean) {
  if (T.header === "stripe") return title ? (sub ? 222 : 160) : sub ? 120 : 52;
  if (T.header === "band") return bandHeight(T, title, sub) + 36;
  // centralizado
  if (!title && !sub) return 52;
  return 46 + (title ? T.title.size * 0.92 : 0) + (sub ? (title ? 70 : 50) : 0) + 46;
}

function bandHeight(T: Theme, title: boolean, sub: boolean) {
  if (!title && !sub) return 22;
  return 44 + (title ? T.title.size * 0.8 : 0) + (sub ? (title ? 24 : 0) + 52 : 0) + 42;
}

function drawHeader(ctx: CanvasRenderingContext2D, T: Theme, m: Metrics, title: string, sub: string, pageLabel: string) {
  ctx.font = font(TEXT_FONT, 24);
  const pageW = pageLabel ? ctx.measureText(pageLabel).width + 28 : 0;

  if (T.header === "stripe") {
    const bar = ctx.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, T.stripe![0]);
    bar.addColorStop(1, T.stripe![1]);
    ctx.fillStyle = bar;
    ctx.fillRect(0, 0, W, STRIPE);
    let y = STRIPE;
    if (title) {
      y += 104;
      ctx.fillStyle = T.title.color;
      ctx.textAlign = "left";
      ctx.fillText(fitText(ctx, title, W - m.pad * 2 - pageW, T.title.size, 40, T.title), m.pad, y);
    }
    if (sub) drawBubble(ctx, T, sub, m.pad + 10, title ? y + 22 : STRIPE + 30, W - m.pad * 2 - pageW - 60);
    if (pageLabel) drawPageLabel(ctx, T, pageLabel, W - m.pad, title ? STRIPE + 100 : STRIPE + 52);
    return;
  }

  if (T.header === "band") {
    const bh = bandHeight(T, !!title, !!sub);
    const g = ctx.createLinearGradient(0, 0, W, bh);
    g.addColorStop(0, T.band![0]);
    g.addColorStop(1, T.band![1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, bh);
    let y = 44;
    if (title) {
      y += T.title.size * 0.8;
      ctx.fillStyle = T.title.color;
      ctx.textAlign = "left";
      ctx.fillText(fitText(ctx, title, W - m.pad * 2 - pageW, T.title.size, 40, T.title), m.pad, y);
      y += 24;
    }
    if (sub) drawPill(ctx, T, sub, m.pad, y, 52, W - m.pad * 2 - pageW, "left");
    if (pageLabel) drawPageLabel(ctx, T, pageLabel, W - m.pad, 44 + (title ? T.title.size * 0.8 : 36));
    return;
  }

  // centralizado (vitrine, colecionador, neon)
  const cx = W / 2;
  let y = 46;
  if (title) {
    y += T.title.size * 0.78;
    const maxW = W - m.pad * 2 - (T.ornament ? 230 : 0);
    const t = fitText(ctx, title, maxW, T.title.size, 40, T.title);
    const tw = ctx.measureText(t).width;
    ctx.textAlign = "center";
    ctx.save();
    if (T.title.gradient) {
      const g = ctx.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0);
      g.addColorStop(0, T.title.gradient[0]);
      g.addColorStop(1, T.title.gradient[1]);
      ctx.fillStyle = g;
    } else ctx.fillStyle = T.title.color;
    if (T.title.glow) {
      ctx.shadowColor = T.title.glow;
      ctx.shadowBlur = 30;
    }
    ctx.fillText(t, cx, y);
    ctx.restore();
    if (T.ornament) {
      // filetes dourados com um losango, como em etiqueta de leilão
      const midY = y - fontPx(ctx) * 0.3;
      ctx.strokeStyle = T.ornament;
      ctx.fillStyle = T.ornament;
      ctx.lineWidth = 2;
      for (const dir of [-1, 1]) {
        const x0 = cx + dir * (tw / 2 + 26);
        const x1 = cx + dir * (tw / 2 + 96);
        ctx.beginPath();
        ctx.moveTo(x0, midY);
        ctx.lineTo(x1, midY);
        ctx.stroke();
        ctx.beginPath();
        const dx = x1 + dir * 9;
        ctx.moveTo(dx - 7, midY);
        ctx.lineTo(dx, midY - 7);
        ctx.lineTo(dx + 7, midY);
        ctx.lineTo(dx, midY + 7);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  if (sub) {
    const top = title ? y + 26 : 40;
    if (T.subtitle.kind === "pill") drawPill(ctx, T, sub, cx, top, 50, W - m.pad * 2 - pageW * 2, "center");
    else {
      const caps = T.subtitle.kind === "caps";
      const f: FontSpec = { family: INTER, weight: caps ? 650 : 500 };
      ctx.save();
      if (caps) tracking(ctx, 5);
      const t = fitText(ctx, caps ? sub.toUpperCase() : sub, W - m.pad * 2 - pageW * 2, caps ? 23 : 30, 16, f);
      ctx.fillStyle = T.subtitle.ink;
      ctx.textAlign = "center";
      ctx.fillText(t, cx, top + 32);
      ctx.restore();
    }
  }
  // no canto de cima, acima da linha do título (não encosta nos filetes)
  if (pageLabel) drawPageLabel(ctx, T, pageLabel, W - m.pad, 36);
}

function drawPageLabel(ctx: CanvasRenderingContext2D, T: Theme, label: string, x: number, y: number) {
  ctx.font = font(TEXT_FONT, 24);
  ctx.fillStyle = T.pageLabel;
  ctx.textAlign = "right";
  ctx.fillText(label, x, y);
}

/** Subtítulo num balão de conversa, como uma mensagem recebida no WhatsApp. */
function drawBubble(ctx: CanvasRenderingContext2D, T: Theme, sub: string, bx: number, by: number, maxW: number) {
  const bh = 54;
  const t = fitText(ctx, sub, maxW, 27, 18, { family: INTER, weight: 500 });
  const bw = ctx.measureText(t).width + 44;
  ctx.save();
  ctx.shadowColor = "rgba(11,20,26,0.13)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1.5;
  ctx.fillStyle = T.subtitle.bg;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, [0, 14, 14, 14]);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(bx + 1, by);
  ctx.lineTo(bx - 9, by);
  ctx.quadraticCurveTo(bx - 12, by + 1, bx - 9, by + 4);
  ctx.lineTo(bx + 1, by + 15);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = T.subtitle.ink;
  ctx.textAlign = "left";
  ctx.fillText(t, bx + 22, by + bh / 2 + fontPx(ctx) * 0.36);
}

/** Subtítulo numa pílula (alinhada à esquerda em x, ou centralizada em x). */
function drawPill(ctx: CanvasRenderingContext2D, T: Theme, sub: string, x: number, y: number, h: number, maxW: number, align: "left" | "center") {
  const t = fitText(ctx, sub, maxW - 48, 26, 18, { family: INTER, weight: 600 });
  const w = ctx.measureText(t).width + 48;
  const px = align === "center" ? x - w / 2 : x;
  ctx.fillStyle = T.subtitle.bg;
  ctx.beginPath();
  ctx.roundRect(px, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = T.subtitle.ink;
  ctx.textAlign = "left";
  ctx.fillText(t, px + 24, y + h / 2 + fontPx(ctx) * 0.36);
}

/** Ícone do WhatsApp (balão com telefone), 24×24. Caminho do Simple Icons (CC0). */
const WHATSAPP_ICON =
  "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z";

function drawWhatsAppButton(
  ctx: CanvasRenderingContext2D,
  T: Theme,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  phone: string,
) {
  const B = T.button;
  ctx.save();
  ctx.shadowColor = B.glow;
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 8;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, B.fill[0]);
  g.addColorStop(1, B.fill[1]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.restore();
  if (B.border) {
    ctx.strokeStyle = B.border;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x + 5, y + 5, w - 10, h - 10, (h - 10) / 2);
    ctx.stroke();
  }
  if (B.shine) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.clip();
    const shine = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
    shine.addColorStop(0, "rgba(255,255,255,0.22)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.fillRect(x, y, w, h * 0.55);
    ctx.restore();
  }

  const main = text || phone;
  const sub = text && phone ? phone : "";
  const iconBox = h * 0.5;
  const gap = h * 0.22;
  const maxText = w - h - iconBox - gap;
  const mainShown = fitText(ctx, main, maxText, sub ? 34 : 36, 20, { family: INTER, weight: 800 });
  const mainSize = fontPx(ctx);
  const mainW = ctx.measureText(mainShown).width;
  let subW = 0;
  let subSize = 0;
  let subShown = "";
  if (sub) {
    subShown = fitText(ctx, sub, maxText, 30, 18, { family: INTER, weight: 700 });
    subSize = fontPx(ctx);
    subW = ctx.measureText(subShown).width;
  }
  const groupW = iconBox + gap + Math.max(mainW, subW);
  const gx = x + (w - groupW) / 2;
  const cy = y + h / 2;
  const light = B.ink.toLowerCase() === "#ffffff" || B.ink.startsWith("#f");
  const textShadow = light && B.shine ? "rgba(0,40,10,0.25)" : "transparent";

  ctx.save();
  ctx.shadowColor = textShadow;
  ctx.shadowOffsetY = 2;
  ctx.shadowBlur = 3;
  ctx.translate(gx, cy - iconBox / 2);
  ctx.scale(iconBox / 24, iconBox / 24);
  ctx.fillStyle = B.icon;
  ctx.fill(new Path2D(WHATSAPP_ICON));
  ctx.restore();

  const tx = gx + iconBox + gap;
  ctx.save();
  ctx.textAlign = "left";
  ctx.fillStyle = B.ink;
  ctx.shadowColor = textShadow;
  ctx.shadowOffsetY = 2;
  ctx.shadowBlur = 3;
  if (sub) {
    // as duas linhas centralizadas como um bloco (altura das letras ≈ 0,73 do tamanho)
    const lineGap = h * 0.13;
    const block = mainSize * 0.73 + lineGap + subSize * 0.73;
    const mainBase = cy - block / 2 + mainSize * 0.73;
    ctx.font = font({ family: INTER, weight: 800 }, mainSize);
    ctx.fillText(mainShown, tx, mainBase);
    ctx.font = font({ family: INTER, weight: 700 }, subSize);
    ctx.globalAlpha = 0.9;
    ctx.fillText(subShown, tx, mainBase + lineGap + subSize * 0.73);
  } else {
    ctx.font = font({ family: INTER, weight: 800 }, mainSize);
    ctx.fillText(mainShown, tx, cy + mainSize * 0.36);
  }
  ctx.restore();
}

function drawCard(ctx: CanvasRenderingContext2D, T: Theme, item: RenderItem, x: number, y: number, m: Metrics) {
  const C = T.card;
  const w = m.cardW;
  const h = m.imgH + m.infoH;
  const off = discountPercent(item.salePrice, item.promoPrice);
  const promo = off != null && item.salePrice != null && item.promoPrice != null;

  // corpo
  ctx.save();
  if (C.blur > 0) {
    ctx.shadowColor = C.shadow;
    ctx.shadowBlur = C.blur;
    ctx.shadowOffsetY = 8;
  }
  ctx.fillStyle = C.bg;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, m.radius);
  ctx.fill();
  ctx.restore();

  // foto: ocupa o topo do card, ou fica num "palco" com margem (inset)
  const inset = Math.round(m.inner * C.inset);
  const px = x + inset;
  const py = y + inset;
  const pw = w - inset * 2;
  const ph = m.imgH - inset;
  ctx.save();
  ctx.beginPath();
  if (inset > 0) ctx.roundRect(px, py, pw, ph, Math.max(6, m.radius - inset * 0.6));
  else ctx.roundRect(x, y, w, h, m.radius);
  ctx.clip();
  ctx.fillStyle = C.photoBg;
  ctx.fillRect(px, py, pw, ph);
  if (item.image) {
    if (item.fit === "blur") drawBlurFill(ctx, item.image, px, py, pw, ph);
    else drawCover(ctx, item.image, px, py, pw, ph);
  } else {
    ctx.fillStyle = T.muted;
    ctx.textAlign = "center";
    ctx.font = font(TEXT_FONT, m.name);
    ctx.fillText("Sem foto", px + pw / 2, py + ph / 2);
  }
  ctx.restore();

  if (C.border) {
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, m.radius);
    ctx.stroke();
  }

  const edge = inset + m.inner * 0.6;
  // selo de desconto
  if (promo) {
    const label = `-${off}%`;
    const bs = T.badge.font.family === OSWALD ? m.badge : Math.round(m.badge * 0.86);
    ctx.font = font(T.badge.font, bs);
    const tw = ctx.measureText(label).width;
    const bh = m.badge * 1.55;
    const bw = tw + m.badge * 0.95;
    const bx = x + edge;
    const by = y + edge;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = T.badge.bg;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, T.badge.font.family === OSWALD ? 10 : bh / 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = T.badge.ink;
    ctx.textAlign = "center";
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + bs * 0.36);
  }

  // número do item, discreto, no canto da foto
  if (item.number != null) {
    const label = String(item.number);
    const ns = Math.round(m.badge * 0.82);
    ctx.font = font({ family: INTER, weight: 700 }, ns);
    const nh = ns * 1.6;
    const nw = Math.max(nh, ctx.measureText(label).width + ns * 0.9);
    const nx = x + w - edge - nw;
    const ny = y + edge;
    ctx.fillStyle = T.chip.bg;
    ctx.beginPath();
    ctx.roundRect(nx, ny, nw, nh, nh / 2);
    ctx.fill();
    ctx.fillStyle = T.chip.ink;
    ctx.textAlign = "center";
    ctx.fillText(label, nx + nw / 2, ny + nh / 2 + ns * 0.36);
  }

  // nome em até 2 linhas
  const ix = x + m.inner;
  const iw = w - m.inner * 2;
  ctx.font = font(T.nameFont, m.name);
  ctx.fillStyle = T.nameFont.color;
  ctx.textAlign = "left";
  const lines = wrapLines(ctx, item.name.trim(), iw, 2);
  const lh = m.name * 1.22;
  lines.forEach((ln, i) => ctx.fillText(ln, ix, y + m.imgH + m.inner + m.name * 0.9 + i * lh));

  // preço: número grande, "R$" pequeno; na promoção fica na cor de destaque e o antigo vai riscado ao lado
  const F = T.priceFont;
  const baseY = y + h - m.inner - 2;
  const price = promo ? item.promoPrice : (item.promoPrice ?? item.salePrice);
  if (price == null) {
    ctx.font = font(TEXT_FONT, Math.round(m.price * 0.6));
    ctx.fillStyle = T.nameFont.color;
    ctx.fillText("Consulte o preço", ix, baseY);
    return;
  }
  const old = promo ? formatBRL(item.salePrice) : "";
  const full = Math.round(m.price * F.scale);
  let size = full;
  let parts = measurePrice(ctx, F, formatBRL(price), size);
  const oldSize = () => Math.round(Math.max(size, m.price * 0.8) * 0.42);
  const oldW = () => {
    if (!old) return 0;
    ctx.font = font({ family: INTER, weight: 500 }, oldSize());
    return ctx.measureText(old).width + size * 0.22;
  };
  while (parts.total + oldW() > iw && size > full * 0.6) {
    size -= 1;
    parts = measurePrice(ctx, F, formatBRL(price), size);
  }
  ctx.fillStyle = promo ? F.promo : F.color;
  ctx.textAlign = "left";
  ctx.font = font({ family: F.family, weight: 600 }, Math.round(size * 0.46));
  ctx.fillText(parts.cur, ix, baseY);
  ctx.font = font(F, size);
  ctx.fillText(parts.num, ix + parts.curW, baseY);

  if (old) {
    const ox = ix + parts.total + size * 0.22;
    const os = oldSize();
    ctx.font = font({ family: INTER, weight: 500 }, os);
    ctx.fillStyle = F.strike;
    ctx.fillText(old, ox, baseY);
    const ow = ctx.measureText(old).width;
    ctx.strokeStyle = F.strike;
    ctx.lineWidth = Math.max(1.5, os * 0.09);
    ctx.beginPath();
    ctx.moveTo(ox - 1, baseY - os * 0.34);
    ctx.lineTo(ox + ow + 1, baseY - os * 0.34);
    ctx.stroke();
  }
}

/** Separa "R$" do número para desenhar o símbolo menor (o número é o que o olho procura). */
function measurePrice(ctx: CanvasRenderingContext2D, F: FontSpec, text: string, size: number) {
  const m = /^(R\$)\s*(.*)$/.exec(text.replace(/ /g, " "));
  const cur = m ? m[1] : "";
  const num = m ? m[2] : text;
  ctx.font = font({ family: F.family, weight: 600 }, Math.round(size * 0.46));
  const curW = cur ? ctx.measureText(cur).width + size * 0.1 : 0;
  ctx.font = font(F, size);
  const numW = ctx.measureText(num).width;
  return { cur, num, curW, total: curW + numW };
}

/** Ajusta o tamanho da fonte para caber; se não couber nem no mínimo, corta com "…". */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, min: number, f: FontSpec): string {
  let s = size;
  ctx.font = font(f, s);
  while (ctx.measureText(text).width > maxW && s > min) {
    s -= 1;
    ctx.font = font(f, s);
  }
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

/** Quebra o texto em até `max` linhas; a última ganha "…" se sobrar texto. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  let i = 0;
  while (i < words.length && lines.length < max) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (!cur || ctx.measureText(next).width <= maxW) {
      cur = next;
      i++;
    } else {
      lines.push(cur);
      cur = "";
    }
  }
  if (cur && lines.length < max) lines.push(cur);
  const last = lines.length - 1;
  if (last >= 0 && (i < words.length || ctx.measureText(lines[last]).width > maxW)) {
    let t = lines[last];
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    lines[last] = t.trimEnd() + "…";
  }
  return lines;
}

/** Tamanho em px da fonte atual do contexto. */
function fontPx(ctx: CanvasRenderingContext2D) {
  return Number(/([\d.]+)px/.exec(ctx.font)?.[1] ?? 16);
}

/** Escala a foto para caber (contain) ou cobrir (cover) o quadro, centralizada. */
function placed(img: HTMLImageElement, x: number, y: number, w: number, h: number, cover: boolean) {
  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;
  const s = cover ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
  const dw = iw * s;
  const dh = ih * s;
  return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh };
}

/** Preenche o quadro inteiro (o que sobra é cortado pelo clip do card). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const p = placed(img, x, y, w, h, true);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, p.x, p.y, p.w, p.h);
  ctx.restore();
}

/** Foto inteira por cima de uma cópia dela mesma, ampliada e desfocada, no lugar das faixas. */
function drawBlurFill(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(blurredCover(img, w, h), x, y, w, h);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(x, y, w, h);
  const p = placed(img, x, y, w, h, false);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, p.x, p.y, p.w, p.h);
  ctx.restore();
}

const blurCache = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>();

/**
 * Fundo desfocado: reduz a foto (em "cover", um pouco ampliada) para um canvas minúsculo,
 * aplica um box blur de 3 passadas e deixa o navegador ampliar suavemente.
 * Funciona em qualquer WebView (não depende de ctx.filter).
 */
function blurredCover(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const key = `${Math.round(w)}x${Math.round(h)}`;
  let byImg = blurCache.get(img);
  const hit = byImg?.get(key);
  if (hit) return hit;

  const tw = Math.max(8, Math.round(w / 8));
  const th = Math.max(8, Math.round(h / 8));
  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  const p = placed(img, 0, 0, tw, th, true);
  const zoom = 1.15; // amplia um pouco: as bordas do blur não ficam claras
  g.drawImage(img, p.x - (p.w * (zoom - 1)) / 2, p.y - (p.h * (zoom - 1)) / 2, p.w * zoom, p.h * zoom);
  const data = g.getImageData(0, 0, tw, th);
  for (let i = 0; i < 3; i++) boxBlur(data.data, tw, th, 2);
  g.putImageData(data, 0, 0);

  if (!byImg) blurCache.set(img, (byImg = new Map()));
  byImg.set(key, c);
  return c;
}

/** Box blur separável (horizontal + vertical), bordas repetidas. */
function boxBlur(px: Uint8ClampedArray, w: number, h: number, r: number) {
  const tmp = new Uint8ClampedArray(px.length);
  const n = r * 2 + 1;
  const pass = (src: Uint8ClampedArray, dst: Uint8ClampedArray, len: number, lines: number, at: (line: number, i: number) => number) => {
    for (let l = 0; l < lines; l++) {
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += src[at(l, Math.min(len - 1, Math.max(0, k))) + ch];
        for (let i = 0; i < len; i++) {
          dst[at(l, i) + ch] = sum / n;
          sum += src[at(l, Math.min(len - 1, i + r + 1)) + ch] - src[at(l, Math.max(0, i - r)) + ch];
        }
      }
      for (let i = 0; i < len; i++) dst[at(l, i) + 3] = 255;
    }
  };
  pass(px, tmp, w, h, (row, i) => (row * w + i) * 4);
  pass(tmp, px, h, w, (col, i) => (i * w + col) * 4);
}

