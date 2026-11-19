import { useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, errorMessage, imageUrl, Sale } from "../api";
import { formatBRL, formatDateTime, normalize, saleSummary, todayISO } from "../format";
import Icon from "./Icon";
import { useToast } from "./Toast";

/** Histórico de vendas: quem comprou, o quê, por quanto e o combinado. */
export default function Sales({ onBack, onChanged }: { onBack: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [query, setQuery] = useState("");

  const load = async () => {
    try {
      setSales(await api.listSales());
    } catch (e) {
      toast.error(errorMessage(e));
      setSales([]);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    if (!sales || !q) return sales ?? [];
    return sales.filter((s) =>
      normalize([s.buyer, s.contact, s.notes, ...s.items.map((i) => i.name)].join(" ")).includes(q),
    );
  }, [sales, query]);

  const totals = useMemo(() => {
    const list = sales ?? [];
    const month = todayISO().slice(0, 7);
    return {
      all: list.reduce((a, s) => a + s.total, 0),
      month: list.filter((s) => s.createdAt.startsWith(month)).reduce((a, s) => a + s.total, 0),
      units: list.reduce((a, s) => a + s.items.reduce((b, i) => b + i.quantity, 0), 0),
    };
  }, [sales]);

  const copy = async (s: Sale) => {
    await writeText(saleSummary(s));
    toast.ok("Resumo copiado — é só colar no WhatsApp.");
  };

  const undo = async (s: Sale) => {
    const ok = await ask(
      `Desfazer a venda${s.buyer ? ` de ${s.buyer}` : ""} (${formatBRL(s.total)})? As unidades voltam para o estoque.`,
      { title: "Desfazer venda", kind: "warning", okLabel: "Desfazer", cancelLabel: "Manter" },
    );
    if (!ok) return;
    try {
      await api.deleteSale(s.id, true);
      toast.ok("Venda desfeita. Estoque devolvido.");
      await load();
      await onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="page sales">
      <header className="topbar" data-tauri-drag-region>
        <div className="topbar-left" data-tauri-drag-region>
          <button className="btn back" onClick={onBack}>
            <Icon name="back" /> Início
          </button>
          <div className="title-block" data-tauri-drag-region>
            <h1>Vendas</h1>
            <span className="subtitle">
              {sales?.length ?? 0} venda(s) · {totals.units} unidade(s)
            </span>
          </div>
        </div>
        <div className="topbar-actions">
          <label className="search-field">
            <Icon name="search" size={15} />
            <input
              className="search"
              placeholder="Buscar comprador, modelo…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      </header>

      <div className="sales-main">
        <div className="sales-stats">
          <div>
            <span>Este mês</span>
            <strong>{formatBRL(totals.month)}</strong>
          </div>
          <div>
            <span>Total vendido</span>
            <strong>{formatBRL(totals.all)}</strong>
          </div>
          <div>
            <span>Unidades vendidas</span>
            <strong>{totals.units}</strong>
          </div>
        </div>

        {sales && sales.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">
              <Icon name="bag" size={28} stroke={1.6} />
            </div>
            <h2>Nenhuma venda ainda</h2>
            <p>Na garagem, selecione os modelos e toque em “Gerar venda”.</p>
          </div>
        ) : (
          <div className="sale-list">
            {visible.map((s) => {
              const units = s.items.reduce((a, i) => a + i.quantity, 0);
              const sum = s.items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
              return (
                <article key={s.id} className="sale-card">
                  <div className="sale-card-head">
                    <div>
                      <h2>{s.buyer || "Sem nome"}</h2>
                      <span className="subtitle">
                        {[s.contact, formatDateTime(s.createdAt)].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <div className="sale-card-total">
                      <strong>{formatBRL(s.total)}</strong>
                      {s.total !== sum && (
                        <span className={s.total < sum ? "neg" : "pos"}>
                          {s.total < sum ? "desconto" : "acréscimo"} {formatBRL(Math.abs(s.total - sum))}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="sale-card-items">
                    {s.items.map((i, k) => {
                      const img = imageUrl(i.imageFile);
                      return (
                        <div key={k} className="sale-chip" title={`${i.quantity}× ${i.name} — ${formatBRL(i.unitPrice)}`}>
                          <span className="sale-chip-img">{img && <img src={img} alt="" loading="lazy" />}</span>
                          <span className="sale-chip-name">
                            {i.quantity > 1 && <b>{i.quantity}× </b>}
                            {i.name}
                          </span>
                          <span className="sale-chip-price">{formatBRL(i.unitPrice)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {s.notes && <p className="sale-notes">{s.notes}</p>}
                  <div className="sale-card-foot">
                    <span className="muted small">
                      {units} {units === 1 ? "unidade" : "unidades"}
                    </span>
                    <div className="spacer" />
                    <button className="btn small plain" onClick={() => undo(s)}>
                      <Icon name="undo" size={14} /> Desfazer
                    </button>
                    <button className="btn small" onClick={() => copy(s)}>
                      <Icon name="copy" size={14} /> Copiar resumo
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
