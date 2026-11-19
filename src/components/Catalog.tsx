import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, Car, coverFit, errorMessage, imageUrl, Settings } from "../api";
import FramedImage from "./FramedImage";
import Icon from "./Icon";
import { centsToInput, discountPercent, formatBRL, parseBRL } from "../format";
import { ensureFonts, paginate, PER_PAGE_OPTIONS, renderPage, RenderOptions, THEMES } from "../catalog/render";

const GRID_LABEL = { 1: "1×1", 4: "2×2", 9: "3×3", 16: "4×4" } as const;
import { useToast } from "./Toast";

const DEFAULTS: Required<Pick<Settings, "catalogTitle" | "catalogSubtitle" | "catalogFooter" | "perPage">> = {
  catalogTitle: "Hot Wheels à venda",
  catalogSubtitle: "",
  catalogFooter: "Chama no zap pra garantir o seu!",
  perPage: 9,
};

interface Page {
  canvas: HTMLCanvasElement;
  preview: string;
}

export default function Catalog({
  items,
  onBack,
  onReorder,
  onCarsChanged,
}: {
  items: Car[];
  onBack: () => void;
  onReorder: (ids: string[]) => void;
  onCarsChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const [pages, setPages] = useState<Page[]>([]);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState<number | null>(null);
  const saveTimer = useRef<number>();

  // Configurações (título, rodapé, 9/16…) ficam salvas no banco
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setSettings({ ...DEFAULTS, ...s }))
      .catch(() => setSettings({ ...DEFAULTS }));
  }, []);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...(s ?? DEFAULTS), ...patch };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => api.saveSettings(next).catch(() => {}), 400);
      return next;
    });
  };

  // Carrega as fotos em alta (data URL) para o canvas
  useEffect(() => {
    let cancelled = false;
    const missing = items
      .map((c) => c.imageFile)
      .filter((f): f is string => !!f && !images.has(f));
    if (!missing.length) return;
    Promise.all(
      missing.map(async (file) => {
        const url = await api.imageDataUrl(file);
        const img = new Image();
        img.src = url;
        await img.decode();
        return [file, img] as const;
      }),
    )
      .then((loaded) => {
        if (cancelled) return;
        setImages((prev) => {
          const next = new Map(prev);
          loaded.forEach(([f, img]) => next.set(f, img));
          return next;
        });
      })
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [items]);

  const opts: RenderOptions | null = useMemo(
    () =>
      settings && {
        perPage: settings.perPage ?? 9,
        title: settings.catalogTitle ?? "",
        subtitle: settings.catalogSubtitle ?? "",
        footer: settings.catalogFooter ?? "",
        phone: settings.catalogPhone ?? "",
        theme: settings.catalogTheme ?? "light",
      },
    [settings],
  );

  // Renderiza as páginas (com um pequeno atraso para não redesenhar a cada tecla)
  useEffect(() => {
    if (!opts) return;
    const allLoaded = items.every((c) => !c.imageFile || images.has(c.imageFile));
    if (!allLoaded) return;
    setRendering(true);
    let cancelled = false;
    const t = window.setTimeout(async () => {
      await ensureFonts();
      // se o usuário mudou algo enquanto as fontes carregavam, esta renderização é descartada
      if (cancelled) return;
      const chunks = paginate(items, opts.perPage);
      const out = chunks.map((chunk, i) => {
        const canvas = renderPage(
          chunk.map((c, k) => ({
            number: i * opts.perPage + k + 1,
            name: c.name,
            salePrice: c.salePrice,
            promoPrice: c.promoPrice,
            image: c.imageFile ? images.get(c.imageFile) ?? null : null,
            fit: coverFit(c),
          })),
          opts,
          i,
          chunks.length,
        );
        return { canvas, preview: canvas.toDataURL("image/jpeg", 0.8) };
      });
      setPages(out);
      setRendering(false);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [items, images, opts]);

  const move = (idx: number, delta: number) => {
    const ids = items.map((c) => c.id);
    const j = idx + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    onReorder(ids);
  };

  const remove = (id: string) => onReorder(items.filter((c) => c.id !== id).map((c) => c.id));

  const saveAll = async () => {
    const dir = await open({
      directory: true,
      defaultPath: settings?.lastCatalogDir,
      title: "Onde salvar as imagens do catálogo?",
    });
    if (typeof dir !== "string") return;
    setSaving(true);
    try {
      const files = await api.saveCatalogPages(
        dir,
        "catalogo",
        pages.map((p) => p.canvas.toDataURL("image/jpeg", 0.92)),
      );
      updateSettings({ lastCatalogDir: dir });
      toast.ok(`${files.length} imagem(ns) salva(s).`);
      if (files[0]) revealItemInDir(files[0]).catch(() => {});
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const copyPage = async (i: number) => {
    const p = pages[i];
    if (!p || copying != null) return;
    setCopying(i);
    try {
      await api.copyImage(p.canvas.toDataURL("image/png"));
      toast.ok(`Página ${i + 1} copiada — é só colar no WhatsApp.`);
    } catch (e) {
      toast.error(`Não consegui copiar: ${errorMessage(e)}`);
    } finally {
      setCopying(null);
    }
  };

  const copyText = async () => {
    const lines = items.map((c, i) => {
      const off = discountPercent(c.salePrice, c.promoPrice);
      const price =
        off != null
          ? `~${formatBRL(c.salePrice)}~ *${formatBRL(c.promoPrice)}* (-${off}%)`
          : c.salePrice != null || c.promoPrice != null
            ? `*${formatBRL(c.promoPrice ?? c.salePrice)}*`
            : "consulte";
      return `${i + 1}. ${c.name} — ${price}`;
    });
    const head = settings?.catalogTitle?.trim() ? `*${settings.catalogTitle.trim()}*\n\n` : "";
    const contact = [settings?.catalogFooter?.trim(), settings?.catalogPhone?.trim()].filter(Boolean).join(" ");
    const foot = contact ? `\n\n${contact}` : "";
    await writeText(head + lines.join("\n") + foot);
    toast.ok("Lista copiada (formatação do WhatsApp).");
  };

  const perPage = settings?.perPage ?? 9;
  const noStock = items.filter((c) => c.quantity <= 0).length;
  const noPhoto = items.filter((c) => !c.imageFile).length;

  return (
    <div className="page catalog">
      <header className="topbar" data-tauri-drag-region>
        <div className="topbar-left" data-tauri-drag-region>
          <button className="btn back" onClick={onBack}>
            <Icon name="back" /> Garagem
          </button>
          <div className="title-block" data-tauri-drag-region>
            <h1>Catálogo de venda</h1>
            <span className="subtitle">
              {items.length} modelo(s) · {pages.length} página(s) de até {perPage}
            </span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={copyText} disabled={!items.length}>
            <Icon name="text" /> Copiar lista
          </button>
          <button className="btn primary" onClick={saveAll} disabled={!pages.length || saving || rendering}>
            <Icon name="export" /> {saving ? "Salvando…" : "Salvar imagens"}
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="empty">
          <p>Nenhum modelo selecionado.</p>
          <button className="btn primary" onClick={onBack}>
            Voltar e selecionar
          </button>
        </div>
      ) : (
        <div className="catalog-layout">
          <aside className="catalog-side">
            <section>
              <h3>Layout</h3>
              <div className="layout-pick">
                {PER_PAGE_OPTIONS.map((n) => (
                  <button
                    key={n}
                    className={perPage === n ? "on" : ""}
                    onClick={() => updateSettings({ perPage: n })}
                    title={`${n} por página (${GRID_LABEL[n]})`}
                  >
                    <span className={`grid-ico g${n}`}>
                      {Array.from({ length: n }, (_, k) => (
                        <i key={k} />
                      ))}
                    </span>
                    <b>{n}</b>
                    <small>{GRID_LABEL[n]}</small>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3>Tema</h3>
              <div className="theme-grid">
                {THEMES.map((t) => {
                  const on = (settings?.catalogTheme ?? "light") === t.id;
                  const sw = t.swatch;
                  return (
                    <button
                      key={t.id}
                      className={`theme-tile ${on ? "on" : ""}`}
                      onClick={() => updateSettings({ catalogTheme: t.id })}
                      title={t.hint}
                    >
                      <span className="mini" style={{ background: sw.bg }}>
                        {sw.headKind === "band" && <span className="mini-band" style={{ background: sw.head }} />}
                        {sw.headKind === "stripe" && <span className="mini-stripe" style={{ background: sw.head }} />}
                        {sw.headKind === "none" && <span className="mini-title" style={{ background: sw.head }} />}
                        <span className="mini-cards">
                          {[0, 1, 2].map((k) => (
                            <span key={k} className="mini-card" style={{ background: sw.card }}>
                              <i style={{ background: sw.price }} />
                            </span>
                          ))}
                        </span>
                        <span className="mini-btn" style={{ background: sw.button }} />
                      </span>
                      <b>{t.name}</b>
                      <small>{t.hint}</small>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h3>Textos</h3>
              <label className="field">
                <span>Título</span>
                <input
                  value={settings?.catalogTitle ?? ""}
                  onChange={(e) => updateSettings({ catalogTitle: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Subtítulo</span>
                <input
                  value={settings?.catalogSubtitle ?? ""}
                  placeholder="Ex.: Lote novo de novembro"
                  onChange={(e) => updateSettings({ catalogSubtitle: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Botão do WhatsApp</span>
                <input
                  value={settings?.catalogFooter ?? ""}
                  placeholder="Ex.: Chama no zap pra garantir o seu!"
                  onChange={(e) => updateSettings({ catalogFooter: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Número do WhatsApp (opcional)</span>
                <input
                  value={settings?.catalogPhone ?? ""}
                  placeholder="Ex.: (11) 9 9999-9999"
                  inputMode="tel"
                  onChange={(e) => updateSettings({ catalogPhone: e.target.value })}
                />
              </label>
              {(noStock > 0 || noPhoto > 0) && (
                <p className="warn small">
                  {noStock > 0 && <>⚠ {noStock} sem estoque. </>}
                  {noPhoto > 0 && <>⚠ {noPhoto} sem foto.</>}
                </p>
              )}
            </section>

            <section>
              <h3>Modelos e preços</h3>
              <p className="muted small">Ajustes de preço aqui já ficam salvos no cadastro.</p>
              <div className="catalog-items">
                {items.map((c, i) => (
                  <CatalogRow
                    key={c.id}
                    car={c}
                    index={i}
                    pageBreak={i > 0 && i % perPage === 0}
                    isFirst={i === 0}
                    isLast={i === items.length - 1}
                    onMove={(d) => move(i, d)}
                    onRemove={() => remove(c.id)}
                    onPricesSaved={onCarsChanged}
                  />
                ))}
              </div>
            </section>
          </aside>

          <main className="catalog-preview">
            {rendering && pages.length === 0 && <p className="muted">Gerando…</p>}
            {pages.map((p, i) => (
              <div key={i} className={`preview-page ${rendering ? "stale" : ""}`}>
                <div className="preview-head">
                  <span>
                    Página {i + 1} de {pages.length}
                  </span>
                  <button
                    className="btn small"
                    onClick={() => copyPage(i)}
                    disabled={rendering || copying != null}
                  >
                    {copying === i ? "Copiando…" : "Copiar imagem"}
                  </button>
                </div>
                <img src={p.preview} alt={`Página ${i + 1}`} />
              </div>
            ))}
          </main>
        </div>
      )}
    </div>
  );
}

function CatalogRow({
  car,
  index,
  pageBreak,
  isFirst,
  isLast,
  onMove,
  onRemove,
  onPricesSaved,
}: {
  car: Car;
  index: number;
  pageBreak: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onPricesSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [sale, setSale] = useState(centsToInput(car.salePrice));
  const [promo, setPromo] = useState(centsToInput(car.promoPrice));

  useEffect(() => {
    setSale(centsToInput(car.salePrice));
    setPromo(centsToInput(car.promoPrice));
  }, [car.salePrice, car.promoPrice]);

  const commit = async () => {
    const s = parseBRL(sale);
    let p = parseBRL(promo);
    if (s == null || (p != null && p >= s)) p = null;
    if (s === car.salePrice && p === car.promoPrice) {
      setSale(centsToInput(s));
      setPromo(centsToInput(p));
      return;
    }
    try {
      await api.updatePrices(car.id, s, p);
      await onPricesSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const img = imageUrl(car.imageFile);
  const off = discountPercent(parseBRL(sale), parseBRL(promo));

  return (
    <>
      {pageBreak && <div className="page-break">nova página</div>}
      <div className="catalog-row">
        <span className="row-n">{index + 1}</span>
        <div className="row-thumb">{img && <FramedImage src={img} fit={coverFit(car)} />}</div>
        <div className="row-main">
          <div className="row-name" title={car.name}>
            {car.name}
            {car.quantity <= 0 && <span className="tag-warn">sem estoque</span>}
          </div>
          <div className="row-prices">
            <label>
              <span>Preço</span>
              <input value={sale} placeholder="0,00" onChange={(e) => setSale(e.target.value)} onBlur={commit} />
            </label>
            <label>
              <span>
                Promo{off != null && <b className="off-chip">-{off}%</b>}
              </span>
              <input value={promo} placeholder="—" onChange={(e) => setPromo(e.target.value)} onBlur={commit} />
            </label>
          </div>
        </div>
        <div className="row-actions">
          <button className="icon-btn" disabled={isFirst} onClick={() => onMove(-1)} title="Subir">
            ▲
          </button>
          <button className="icon-btn" disabled={isLast} onClick={() => onMove(1)} title="Descer">
            ▼
          </button>
          <button className="icon-btn" onClick={onRemove} title="Tirar do catálogo">
            ✕
          </button>
        </div>
      </div>
    </>
  );
}
