import { useEffect, useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { api, Car, COLLECTION, CollectionStats, coverFit, errorMessage, imageUrl, Sale } from "../api";
import FramedImage from "./FramedImage";
import Icon from "./Icon";
import { formatBRL, todayISO } from "../format";
import { useToast } from "./Toast";
import Modal from "./Modal";

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
      filters: [{ name: "Backup do Garimpalo", extensions: ["zip"] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      const n = await api.exportBackup(dest);
      toast.ok(`Backup exportado: ${n} modelo(s) com fotos.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pickImport = async () => {
    const src = await open({
      multiple: false,
      filters: [{ name: "Backup do Garimpalo", extensions: ["zip"] }],
    });
    if (typeof src === "string") setImportPath(src);
  };

  const doImport = async (replace: boolean) => {
    if (!importPath) return;
    setBusy(true);
    try {
      const r = await api.importBackup(importPath, replace);
      toast.ok(`Importado: ${r.cars} modelo(s), ${r.images} foto(s).`);
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
          <button className="btn" onClick={doExport} disabled={busy}>
            <Icon name="export" /> Exportar backup
          </button>
          <button className="btn" onClick={pickImport} disabled={busy}>
            <Icon name="import" /> Importar
          </button>
        </div>
      </header>

      <main className="home-main">
        <p className="eyebrow">Sua garagem</p>
        <h1 className="large-title">Coleções</h1>

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
                <div className="shelf-empty">Adicione o primeiro carrinho</div>
              )}
            </div>
            <div className="collection-body">
              <div className="collection-title">
                <div>
                  <h2>Hot Wheels</h2>
                  <span className="subtitle">
                    {stats?.models ?? 0} modelos · {stats?.units ?? 0} unidades
                  </span>
                </div>
                <span className="open-chip">
                  Abrir <Icon name="chevron" size={14} />
                </span>
              </div>
              <div className="collection-stats">
                <div>
                  <span>Investido</span>
                  <strong>{formatBRL(stats?.invested ?? 0)}</strong>
                </div>
                <div>
                  <span>À venda</span>
                  <strong>{formatBRL(forSale)}</strong>
                </div>
                <div>
                  <span>Lucro potencial</span>
                  <strong className={forSale - (stats?.invested ?? 0) >= 0 ? "pos" : "neg"}>
                    {formatBRL(forSale - (stats?.invested ?? 0))}
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
                <span className="eyebrow">Vendas</span>
                <strong>{formatBRL(monthTotal)}</strong>
                <span className="subtitle">
                  {monthSales.length} {monthSales.length === 1 ? "venda" : "vendas"} este mês · {sales.length} no total
                </span>
              </div>
              <Icon name="chevron" size={15} />
            </button>

            <div className="collection-card collection-soon" title="Em breve">
              <div className="soon-icon">
                <Icon name="plus" size={20} />
              </div>
              <strong>Nova coleção</strong>
              <span>Em breve</span>
            </div>
          </div>
        </div>
      </main>

      {importPath && (
        <Modal
          title="Importar backup"
          onClose={() => !busy && setImportPath(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setImportPath(null)} disabled={busy}>
                Cancelar
              </button>
              <button className="btn danger" onClick={() => doImport(true)} disabled={busy}>
                Substituir tudo
              </button>
              <button className="btn primary" onClick={() => doImport(false)} disabled={busy}>
                Mesclar
              </button>
            </>
          }
        >
          <p className="muted small break">{importPath}</p>
          <p>
            <strong>Mesclar</strong>: adiciona o que é novo e atualiza os modelos que já existem
            (mesmo cadastro). Nada é apagado.
          </p>
          <p>
            <strong>Substituir tudo</strong>: apaga a garagem atual e deixa exatamente como está no
            backup.
          </p>
        </Modal>
      )}
    </div>
  );
}
