import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, Car, coverFit, errorMessage, imageUrl, Settings } from "../api";
import FramedImage from "./FramedImage";
import Icon from "./Icon";
import { centsToInput, discountPercent, formatMoney, parseMoney, zeroInput } from "../format";
import { L, P } from "../i18n";
import { ensureFonts, paginate, PER_PAGE_OPTIONS, renderPage, RenderOptions, themeLabel, THEMES } from "../catalog/render";

const GRID_LABEL = { 1: "1×1", 4: "2×2", 9: "3×3", 16: "4×4" } as const;
import { useToast } from "./Toast";

type Defaults = Required<Pick<Settings, "catalogTitle" | "catalogSubtitle" | "catalogFooter" | "perPage">>;
const defaults = (): Defaults => ({
  catalogTitle: L("Hot Wheels à venda", "Hot Wheels for sale"),
  catalogSubtitle: "",
  catalogFooter: L("Chama no zap pra garantir o seu!", "Message me on WhatsApp to grab yours!"),
  perPage: 9,
});

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
      .then((s) => setSettings({ ...defaults(), ...s }))
      .catch(() => setSettings({ ...defaults() }));
  }, []);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...(s ?? defaults()), ...patch };
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
      title: L("Onde salvar as imagens do catálogo?", "Where should the catalog images be saved?"),
    });
    if (typeof dir !== "string") return;
    setSaving(true);
    try {
      const files = await api.saveCatalogPages(
        dir,
        L("catalogo", "catalog"),
        pages.map((p) => p.canvas.toDataURL("image/jpeg", 0.92)),
      );
      updateSettings({ lastCatalogDir: dir });
      toast.ok(L(`${files.length} imagem(ns) salva(s).`, `${files.length} image(s) saved.`));
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
      toast.ok(L(`Página ${i + 1} copiada — é só colar no WhatsApp.`, `Page ${i + 1} copied — just paste it into WhatsApp.`));
    } catch (e) {
      toast.error(`${L("Não consegui copiar", "Couldn't copy")}: ${errorMessage(e)}`);
    } finally {
      setCopying(null);
    }
  };

  const copyText = async () => {
    const lines = items.map((c, i) => {
      const off = discountPercent(c.salePrice, c.promoPrice);
      const price =
        off != null
          ? `~${formatMoney(c.salePrice)}~ *${formatMoney(c.promoPrice)}* (-${off}%)`
          : c.salePrice != null || c.promoPrice != null
            ? `*${formatMoney(c.promoPrice ?? c.salePrice)}*`
            : L("consulte", "ask for price");
      return `${i + 1}. ${c.name} — ${price}`;
    });
    const head = settings?.catalogTitle?.trim() ? `*${settings.catalogTitle.trim()}*\n\n` : "";
    const contact = [settings?.catalogFooter?.trim(), settings?.catalogPhone?.trim()].filter(Boolean).join(" ");
    const foot = contact ? `\n\n${contact}` : "";
    await writeText(head + lines.join("\n") + foot);
    toast.ok(L("Lista copiada (formatação do WhatsApp).", "List copied (WhatsApp formatting)."));
  };

  const perPage = settings?.perPage ?? 9;
  const noStock = items.filter((c) => c.quantity <= 0).length;
  const noPhoto = items.filter((c) => !c.imageFile).length;

  return (
    <div className="page catalog">
      <header className="topbar" data-tauri-drag-region>
        <div className="topbar-left" data-tauri-drag-region>
          <button className="btn back" onClick={onBack}>
            <Icon name="back" /> {L("Garagem", "Garage")}
          </button>
          <div className="title-block" data-tauri-drag-region>
            <h1>{L("Catálogo de venda", "Sales catalog")}</h1>
            <span className="subtitle">
              {P(items.length, ["modelo", "modelos"], ["model", "models"])} ·{" "}
              {P(pages.length, ["página", "páginas"], ["page", "pages"])} {L("de até", "of up to")} {perPage}
            </span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={copyText} disabled={!items.length}>
            <Icon name="text" /> {L("Copiar lista", "Copy list")}
          </button>
          <button className="btn primary" onClick={saveAll} disabled={!pages.length || saving || rendering}>
            <Icon name="export" /> {saving ? L("Salvando…", "Saving…") : L("Salvar imagens", "Save images")}
          </button>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="empty">
          <p>{L("Nenhum modelo selecionado.", "No models selected.")}</p>
          <button className="btn primary" onClick={onBack}>
            {L("Voltar e selecionar", "Go back and select")}
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
                    title={`${n} ${L("por página", "per page")} (${GRID_LABEL[n]})`}
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
              <h3>{L("Tema", "Theme")}</h3>
              <div className="theme-grid">
                {THEMES.map((t) => {
                  const on = (settings?.catalogTheme ?? "light") === t.id;
                  const sw = t.swatch;
                  return (
                    <button
                      key={t.id}
                      className={`theme-tile ${on ? "on" : ""}`}
                      onClick={() => updateSettings({ catalogTheme: t.id })}
                      title={themeLabel(t).hint}
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
                      <b>{themeLabel(t).name}</b>
                      <small>{themeLabel(t).hint}</small>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h3>{L("Textos", "Text")}</h3>
              <label className="field">
                <span>{L("Título", "Title")}</span>
                <input
                  value={settings?.catalogTitle ?? ""}
                  onChange={(e) => updateSettings({ catalogTitle: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{L("Subtítulo", "Subtitle")}</span>
                <input
                  value={settings?.catalogSubtitle ?? ""}
                  placeholder={L("Ex.: Lote novo de novembro", "e.g. New November batch")}
                  onChange={(e) => updateSettings({ catalogSubtitle: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{L("Botão do WhatsApp", "WhatsApp button")}</span>
                <input
                  value={settings?.catalogFooter ?? ""}
                  placeholder={L("Ex.: Chama no zap pra garantir o seu!", "e.g. Message me on WhatsApp to grab yours!")}
                  onChange={(e) => updateSettings({ catalogFooter: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{L("Número do WhatsApp (opcional)", "WhatsApp number (optional)")}</span>
                <input
                  value={settings?.catalogPhone ?? ""}
                  placeholder={L("Ex.: (11) 9 9999-9999", "e.g. +1 555 123 4567")}
                  inputMode="tel"
                  onChange={(e) => updateSettings({ catalogPhone: e.target.value })}
                />
              </label>
              {(noStock > 0 || noPhoto > 0) && (
                <p className="warn small">
                  {noStock > 0 && <>⚠ {noStock} {L("sem estoque", "out of stock")}. </>}
                  {noPhoto > 0 && <>⚠ {noPhoto} {L("sem foto", "without a photo")}.</>}
                </p>
              )}
            </section>

            <section>
              <h3>{L("Modelos e preços", "Models and prices")}</h3>
              <p className="muted small">{L("Ajustes de preço aqui já ficam salvos no cadastro.", "Price changes here are saved to the model right away.")}</p>
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
            {rendering && pages.length === 0 && <p className="muted">{L("Gerando…", "Rendering…")}</p>}
            {pages.map((p, i) => (
              <div key={i} className={`preview-page ${rendering ? "stale" : ""}`}>
                <div className="preview-head">
                  <span>
                    {L("Página", "Page")} {i + 1} {L("de", "of")} {pages.length}
                  </span>
                  <button
                    className="btn small"
                    onClick={() => copyPage(i)}
                    disabled={rendering || copying != null}
                  >
                    {copying === i ? L("Copiando…", "Copying…") : L("Copiar imagem", "Copy image")}
                  </button>
                </div>
                <img src={p.preview} alt={`${L("Página", "Page")} ${i + 1}`} />
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
    const s = parseMoney(sale);
    let p = parseMoney(promo);
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
  const off = discountPercent(parseMoney(sale), parseMoney(promo));

  return (
    <>
      {pageBreak && <div className="page-break">{L("nova página", "new page")}</div>}
      <div className="catalog-row">
        <span className="row-n">{index + 1}</span>
        <div className="row-thumb">{img && <FramedImage src={img} fit={coverFit(car)} />}</div>
        <div className="row-main">
          <div className="row-name" title={car.name}>
            {car.name}
            {car.quantity <= 0 && <span className="tag-warn">{L("sem estoque", "out of stock")}</span>}
          </div>
          <div className="row-prices">
            <label>
              <span>{L("Preço", "Price")}</span>
              <input value={sale} placeholder={zeroInput()} onChange={(e) => setSale(e.target.value)} onBlur={commit} />
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
          <button className="icon-btn" disabled={isFirst} onClick={() => onMove(-1)} title={L("Subir", "Move up")}>
            ▲
          </button>
          <button className="icon-btn" disabled={isLast} onClick={() => onMove(1)} title={L("Descer", "Move down")}>
            ▼
          </button>
          <button className="icon-btn" onClick={onRemove} title={L("Tirar do catálogo", "Remove from catalog")}>
            ✕
          </button>
        </div>
      </div>
    </>
  );
}
