import { useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, Car, coverFit, errorMessage, imageUrl } from "../api";
import { centsToInput, currencySymbol, finalPrice, formatMoney, parseMoney, saleSummary, zeroInput } from "../format";
import { L } from "../i18n";
import FramedImage from "./FramedImage";
import Icon from "./Icon";
import Modal from "./Modal";
import { useToast } from "./Toast";

interface Line {
  car: Car;
  qty: number;
  price: string;
}

/** Registrar uma venda dos modelos selecionados: comprador, contato, valores combinados e observação. */
export default function SaleForm({
  cars,
  onClose,
  onDone,
}: {
  cars: Car[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [buyer, setBuyer] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>(() =>
    cars.map((car) => ({ car, qty: 1, price: centsToInput(finalPrice(car.salePrice, car.promoPrice)) })),
  );
  /** total digitado à mão (correção do valor); vazio = soma dos itens */
  const [totalInput, setTotalInput] = useState("");
  const [updateStock, setUpdateStock] = useState(true);
  const [busy, setBusy] = useState(false);

  const items = lines.map((l) => ({ name: l.car.name, quantity: l.qty, unitPrice: parseMoney(l.price) ?? 0 }));
  const sum = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const typedTotal = parseMoney(totalInput);
  const total = typedTotal ?? sum;
  const adj = total - sum;
  const units = lines.reduce((a, l) => a + l.qty, 0);
  const missingPrice = lines.some((l) => parseMoney(l.price) == null);
  const overStock = useMemo(() => lines.filter((l) => l.qty > l.car.quantity), [lines]);

  const patch = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const remove = (i: number) => setLines((ls) => ls.filter((_, k) => k !== i));

  const copy = async () => {
    await writeText(saleSummary({ buyer, notes, total, items }));
    toast.ok(L("Resumo copiado — é só colar no WhatsApp.", "Summary copied — just paste it into WhatsApp."));
  };

  const submit = async () => {
    if (!lines.length) return;
    setBusy(true);
    try {
      await api.createSale({
        buyer,
        contact,
        notes,
        total: typedTotal,
        items: lines.map((l) => ({ carId: l.car.id, quantity: l.qty, unitPrice: parseMoney(l.price) ?? 0 })),
        updateStock,
      });
      toast.ok(`${L("Venda registrada", "Sale recorded")} · ${formatMoney(total)}`);
      await onDone();
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={L("Nova venda", "New sale")}
      wide
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn plain" onClick={copy} disabled={!lines.length}>
            <Icon name="copy" /> {L("Copiar resumo", "Copy summary")}
          </button>
          <div className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            {L("Cancelar", "Cancel")}
          </button>
          <button className="btn primary" onClick={submit} disabled={busy || !lines.length}>
            <Icon name="check" /> {busy ? L("Registrando…", "Recording…") : L("Registrar venda", "Record sale")}
          </button>
        </>
      }
    >
      <div className="sale-form">
        <div className="sale-left">
          <div className="row two">
            <label className="field">
              <span>{L("Comprador", "Buyer")}</span>
              <input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder={L("Nome de quem comprou", "Who bought it")} autoFocus />
            </label>
            <label className="field">
              <span>{L("Contato", "Contact")}</span>
              <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder={L("WhatsApp, telefone ou @", "WhatsApp, phone or @")} />
            </label>
          </div>

          <div className="sale-items">
            {lines.map((l, i) => {
              const img = imageUrl(l.car.imageFile);
              const unit = parseMoney(l.price);
              const listed = finalPrice(l.car.salePrice, l.car.promoPrice);
              return (
                <div key={l.car.id} className="sale-item">
                  <div className="sale-thumb">{img && <FramedImage src={img} fit={coverFit(l.car)} />}</div>
                  <div className="sale-item-main">
                    <div className="sale-item-name" title={l.car.name}>
                      {l.car.name}
                    </div>
                    <div className="sale-item-sub">
                      {listed != null && unit != null && unit !== listed ? (
                        <span className="adjusted">
                          {L("catálogo", "catalog")} {formatMoney(listed)}
                        </span>
                      ) : (
                        <span>
                          {l.car.quantity} {L("em estoque", "in stock")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="stepper">
                    <button onClick={() => patch(i, { qty: Math.max(1, l.qty - 1) })} disabled={l.qty <= 1} aria-label={L("Menos 1", "One less")}>
                      <Icon name="minus" size={12} stroke={2.4} />
                    </button>
                    <span>{l.qty}</span>
                    <button onClick={() => patch(i, { qty: l.qty + 1 })} aria-label={L("Mais 1", "One more")}>
                      <Icon name="plus" size={12} stroke={2.4} />
                    </button>
                  </div>
                  <div className="money small-money">
                    <span>{currencySymbol()}</span>
                    <input
                      inputMode="decimal"
                      value={l.price}
                      placeholder={zeroInput()}
                      onChange={(e) => patch(i, { price: e.target.value })}
                      onBlur={() => {
                        const c = parseMoney(l.price);
                        patch(i, { price: c == null ? "" : centsToInput(c) });
                      }}
                    />
                  </div>
                  <button className="icon-btn" onClick={() => remove(i)} title={L("Tirar da venda", "Remove from sale")}>
                    <Icon name="close" size={13} stroke={2.2} />
                  </button>
                </div>
              );
            })}
            {!lines.length && <p className="muted small">{L("Nenhum modelo na venda.", "No models in this sale.")}</p>}
          </div>

          <label className="field">
            <span>{L("Observação", "Notes")}</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={L("Forma de pagamento, entrega, retirada, combinado…", "Payment method, delivery, pickup, what was agreed…")}
            />
          </label>
        </div>

        <aside className="sale-summary">
          <div className="sum-row">
            <span>
              {units} {units === 1 ? "item" : L("itens", "items")}
            </span>
            <span>{formatMoney(sum)}</span>
          </div>
          <label className="field">
            <span>{L("Valor final", "Final amount")}</span>
            <div className="money big-money">
              <span>{currencySymbol()}</span>
              <input
                inputMode="decimal"
                value={totalInput}
                placeholder={centsToInput(sum)}
                onChange={(e) => setTotalInput(e.target.value)}
                onBlur={() => {
                  const c = parseMoney(totalInput);
                  setTotalInput(c == null || c === sum ? "" : centsToInput(c));
                }}
              />
            </div>
          </label>
          {adj !== 0 && (
            <div className={`sum-adj ${adj < 0 ? "neg" : "pos"}`}>
              {adj < 0 ? L("Desconto de", "Discount of") : L("Acréscimo de", "Surcharge of")} {formatMoney(Math.abs(adj))}
              <button className="link" onClick={() => setTotalInput("")}>
                {L("desfazer", "undo")}
              </button>
            </div>
          )}
          <div className="sum-total">
            <span>Total</span>
            <strong>{formatMoney(total)}</strong>
          </div>
          <label className="switch">
            <input type="checkbox" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)} />
            <span className="switch-track" />
            {L("Dar baixa no estoque", "Deduct from stock")}
          </label>
          {updateStock && overStock.length > 0 && (
            <p className="warn small">
              {L(
                `Mais unidades que o estoque em ${overStock.length} modelo(s): o estoque fica em 0.`,
                `More units than in stock for ${overStock.length} model(s): stock will be set to 0.`,
              )}
            </p>
          )}
          {missingPrice && (
            <p className="warn small">
              {L("Há modelo sem valor (conta como", "A model has no price (counts as")} {formatMoney(0)}).
            </p>
          )}
        </aside>
      </div>
    </Modal>
  );
}
