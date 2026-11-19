import { useEffect, useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { api, Car, COLLECTION, CollectionStats, coverFit, errorMessage, imageUrl, Sale } from "../api";
import FramedImage from "./FramedImage";
import Icon from "./Icon";
import { formatMoney, todayISO } from "../format";
import { CURRENCIES, getCurrency, getLang, L, LANGS, P } from "../i18n";
import { savePrefs } from "../api";
import { useToast } from "./Toast";
import Modal from "./Modal";

let keepPrefsOpen = false;

export default function Home({
  cars,
  onOpen,
  onSales,
  onDataChanged,
}: {
  cars: Car[];
  onOpen: () => void;
  onSales: () => void;
  onDataChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // trocar idioma remonta a tela: o painel reabre sozinho
  const [prefsOpen, setPrefsOpen] = useState(keepPrefsOpen);
  useEffect(() => {
    keepPrefsOpen = false;
  }, []);

  const loadStats = async () => {
    const all = await api.stats();
    setStats(all.find((s) => s.collection === COLLECTION) ?? null);
    setSales(await api.listSales());
  };

  useEffect(() => {
    loadStats().catch((e) => toast.error(errorMessage(e)));
  }, []);

  const doExport = async () => {
    const dest = await save({
      defaultPath: `garimpalo-backup-${todayISO()}.zip`,
      filters: [{ name: L("Backup do Garimpalo", "Garimpalo backup"), extensions: ["zip"] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      const n = await api.exportBackup(dest);
      toast.ok(L(`Backup exportado: ${n} modelo(s) com fotos.`, `Backup exported: ${n} model(s) with photos.`));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pickImport = async () => {
    const src = await open({
      multiple: false,
      filters: [{ name: L("Backup do Garimpalo", "Garimpalo backup"), extensions: ["zip"] }],
    });
    if (typeof src === "string") setImportPath(src);
  };

  const doImport = async (replace: boolean) => {
    if (!importPath) return;
    setBusy(true);
    try {
      const r = await api.importBackup(importPath, replace);
      toast.ok(L(`Importado: ${r.cars} modelo(s), ${r.images} foto(s).`, `Imported: ${r.cars} model(s), ${r.images} photo(s).`));
      setImportPath(null);
      await loadStats();
      await onDataChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // vitrine: as capas mais recentes, como uma prateleira
  const shelf = cars.filter((c) => c.imageFile).slice(0, 5);
  const forSale = stats?.forSaleValue ?? 0;
  const month = todayISO().slice(0, 7);
  const monthSales = sales.filter((s) => s.createdAt.startsWith(month));
  const monthTotal = monthSales.reduce((a, s) => a + s.total, 0);

  return (
    <div className="page home">
      <header className="topbar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          Garimpalo
        </div>
        <div className="topbar-actions">
          <button className="btn" onClick={() => setPrefsOpen(true)} title={L("Idioma e moeda", "Language and currency")}>
            <Icon name="globe" /> {getLang() === "en" ? "EN" : "PT"} · {getCurrency()}
          </button>
          <button className="btn" onClick={doExport} disabled={busy}>
            <Icon name="export" /> {L("Exportar backup", "Export backup")}
          </button>
          <button className="btn" onClick={pickImport} disabled={busy}>
            <Icon name="import" /> {L("Importar", "Import")}
          </button>
        </div>
      </header>

      <main className="home-main">
        <p className="eyebrow">{L("Sua garagem", "Your garage")}</p>
        <h1 className="large-title">{L("Coleções", "Collections")}</h1>

        <div className="collections">
          <button className="collection-card" onClick={onOpen}>
            <div className="shelf">
              {shelf.length ? (
                shelf.map((c) => (
                  <div key={c.id} className="shelf-item">
                    <FramedImage src={imageUrl(c.imageFile)!} fit={coverFit(c)} />
                  </div>
                ))
              ) : (
                <div className="shelf-empty">{L("Adicione o primeiro carrinho", "Add your first car")}</div>
              )}
            </div>
            <div className="collection-body">
              <div className="collection-title">
                <div>
                  <h2>Hot Wheels</h2>
                  <span className="subtitle">
                    {P(stats?.models ?? 0, ["modelo", "modelos"], ["model", "models"])} ·{" "}
                    {P(stats?.units ?? 0, ["unidade", "unidades"], ["unit", "units"])}
                  </span>
                </div>
                <span className="open-chip">
                  {L("Abrir", "Open")} <Icon name="chevron" size={14} />
                </span>
              </div>
              <div className="collection-stats">
                <div>
                  <span>{L("Investido", "Invested")}</span>
                  <strong>{formatMoney(stats?.invested ?? 0)}</strong>
                </div>
                <div>
                  <span>{L("À venda", "For sale")}</span>
                  <strong>{formatMoney(forSale)}</strong>
                </div>
                <div>
                  <span>{L("Lucro potencial", "Potential profit")}</span>
                  <strong className={forSale - (stats?.invested ?? 0) >= 0 ? "pos" : "neg"}>
                    {formatMoney(forSale - (stats?.invested ?? 0))}
                  </strong>
                </div>
              </div>
            </div>
          </button>

          <div className="home-side">
            <button className="collection-card sales-card" onClick={onSales}>
              <div className="sales-card-icon">
                <Icon name="bag" size={20} />
              </div>
              <div className="sales-card-body">
                <span className="eyebrow">{L("Vendas", "Sales")}</span>
                <strong>{formatMoney(monthTotal)}</strong>
                <span className="subtitle">
                  {P(monthSales.length, ["venda", "vendas"], ["sale", "sales"])} {L("este mês", "this month")} ·{" "}
                  {sales.length} {L("no total", "total")}
                </span>
              </div>
              <Icon name="chevron" size={15} />
            </button>

            <div className="collection-card collection-soon" title={L("Em breve", "Coming soon")}>
              <div className="soon-icon">
                <Icon name="plus" size={20} />
              </div>
              <strong>{L("Nova coleção", "New collection")}</strong>
              <span>{L("Em breve", "Coming soon")}</span>
            </div>
          </div>
        </div>
      </main>

      {importPath && (
        <Modal
          title={L("Importar backup", "Import backup")}
          onClose={() => !busy && setImportPath(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setImportPath(null)} disabled={busy}>
                {L("Cancelar", "Cancel")}
              </button>
              <button className="btn danger" onClick={() => doImport(true)} disabled={busy}>
                {L("Substituir tudo", "Replace everything")}
              </button>
              <button className="btn primary" onClick={() => doImport(false)} disabled={busy}>
                {L("Mesclar", "Merge")}
              </button>
            </>
          }
        >
          <p className="muted small break">{importPath}</p>
          {getLang() === "en" ? (
            <>
              <p>
                <strong>Merge</strong>: adds what's new and updates the models that already exist (same entry).
                Nothing is deleted.
              </p>
              <p>
                <strong>Replace everything</strong>: deletes the current garage and leaves it exactly as it is in the
                backup.
              </p>
            </>
          ) : (
            <>
              <p>
                <strong>Mesclar</strong>: adiciona o que é novo e atualiza os modelos que já existem
                (mesmo cadastro). Nada é apagado.
              </p>
              <p>
                <strong>Substituir tudo</strong>: apaga a garagem atual e deixa exatamente como está no
                backup.
              </p>
            </>
          )}
        </Modal>
      )}

      {prefsOpen && <PrefsModal onClose={() => setPrefsOpen(false)} />}
    </div>
  );
}

/** Idioma da interface e moeda dos preços. Trocar aplica na hora e fica salvo (vai junto no backup). */
function PrefsModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const set = (p: Parameters<typeof savePrefs>[0]) => {
    keepPrefsOpen = true;
    savePrefs(p).catch((e) => toast.error(errorMessage(e)));
  };
  return (
    <Modal title={L("Preferências", "Preferences")} onClose={onClose}>
      <div className="prefs">
        <section>
          <h3>{L("Idioma", "Language")}</h3>
          <div className="segmented">
            {LANGS.map((l) => (
              <button key={l.id} className={getLang() === l.id ? "on" : ""} onClick={() => set({ language: l.id })}>
                {l.label}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>{L("Moeda", "Currency")}</h3>
          <div className="segmented">
            {CURRENCIES.map((c) => (
              <button key={c.id} className={getCurrency() === c.id ? "on" : ""} onClick={() => set({ currency: c.id })}>
                {c.label}
              </button>
            ))}
          </div>
          <p className="muted small">
            {L(
              "Muda só o símbolo e o formato dos números; os valores cadastrados continuam os mesmos.",
              "Only changes the symbol and number format; the prices you entered stay the same.",
            )}
          </p>
        </section>
      </div>
    </Modal>
  );
}
