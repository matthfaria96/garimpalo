import { useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, errorMessage, imageUrl, Sale } from "../api";
import { formatMoney, formatDateTime, normalize, saleSummary, todayISO } from "../format";
import { L, P } from "../i18n";
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
    toast.ok(L("Resumo copiado — é só colar no WhatsApp.", "Summary copied — just paste it into WhatsApp."));
  };

  const undo = async (s: Sale) => {
    const ok = await ask(
      L(
        `Desfazer a venda${s.buyer ? ` de ${s.buyer}` : ""} (${formatMoney(s.total)})? As unidades voltam para o estoque.`,
        `Undo the sale${s.buyer ? ` to ${s.buyer}` : ""} (${formatMoney(s.total)})? The units go back into stock.`,
      ),
      {
        title: L("Desfazer venda", "Undo sale"),
        kind: "warning",
        okLabel: L("Desfazer", "Undo"),
        cancelLabel: L("Manter", "Keep"),
      },
    );
    if (!ok) return;
    try {
      await api.deleteSale(s.id, true);
      toast.ok(L("Venda desfeita. Estoque devolvido.", "Sale undone. Stock restored."));
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
            <Icon name="back" /> {L("Início", "Home")}
          </button>
          <div className="title-block" data-tauri-drag-region>
            <h1>{L("Vendas", "Sales")}</h1>
            <span className="subtitle">
              {P(sales?.length ?? 0, ["venda", "vendas"], ["sale", "sales"])} ·{" "}
              {P(totals.units, ["unidade", "unidades"], ["unit", "units"])}
            </span>
          </div>
        </div>
        <div className="topbar-actions">
          <label className="search-field">
            <Icon name="search" size={15} />
            <input
              className="search"
              placeholder={L("Buscar comprador, modelo…", "Search buyer, model…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      </header>

      <div className="sales-main">
        <div className="sales-stats">
          <div>
            <span>{L("Este mês", "This month")}</span>
            <strong>{formatMoney(totals.month)}</strong>
          </div>
          <div>
            <span>{L("Total vendido", "Total sold")}</span>
            <strong>{formatMoney(totals.all)}</strong>
          </div>
          <div>
            <span>{L("Unidades vendidas", "Units sold")}</span>
            <strong>{totals.units}</strong>
          </div>
        </div>

        {sales && sales.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">
              <Icon name="bag" size={28} stroke={1.6} />
            </div>
            <h2>{L("Nenhuma venda ainda", "No sales yet")}</h2>
            <p>
              {L(
                "Na garagem, selecione os modelos e toque em “Gerar venda”.",
                "In the garage, select the models and click “Record sale”.",
              )}
            </p>
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
                      <h2>{s.buyer || L("Sem nome", "No name")}</h2>
                      <span className="subtitle">
                        {[s.contact, formatDateTime(s.createdAt)].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <div className="sale-card-total">
                      <strong>{formatMoney(s.total)}</strong>
                      {s.total !== sum && (
                        <span className={s.total < sum ? "neg" : "pos"}>
                          {s.total < sum ? L("desconto", "discount") : L("acréscimo", "surcharge")} {formatMoney(Math.abs(s.total - sum))}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="sale-card-items">
                    {s.items.map((i, k) => {
                      const img = imageUrl(i.imageFile);
                      return (
                        <div key={k} className="sale-chip" title={`${i.quantity}× ${i.name} — ${formatMoney(i.unitPrice)}`}>
                          <span className="sale-chip-img">{img && <img src={img} alt="" loading="lazy" />}</span>
                          <span className="sale-chip-name">
                            {i.quantity > 1 && <b>{i.quantity}× </b>}
                            {i.name}
                          </span>
                          <span className="sale-chip-price">{formatMoney(i.unitPrice)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {s.notes && <p className="sale-notes">{s.notes}</p>}
                  <div className="sale-card-foot">
                    <span className="muted small">
                      {P(units, ["unidade", "unidades"], ["unit", "units"])}
                    </span>
                    <div className="spacer" />
                    <button className="btn small plain" onClick={() => undo(s)}>
                      <Icon name="undo" size={14} /> {L("Desfazer", "Undo")}
                    </button>
                    <button className="btn small" onClick={() => copy(s)}>
                      <Icon name="copy" size={14} /> {L("Copiar resumo", "Copy summary")}
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
