import { useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { api, Car, coverFit, errorMessage, imageUrl } from "../api";
import { centsToInput, finalPrice, formatBRL, parseBRL, saleSummary } from "../format";
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

  const items = lines.map((l) => ({ name: l.car.name, quantity: l.qty, unitPrice: parseBRL(l.price) ?? 0 }));
  const sum = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const typedTotal = parseBRL(totalInput);
  const total = typedTotal ?? sum;
  const adj = total - sum;
  const units = lines.reduce((a, l) => a + l.qty, 0);
  const missingPrice = lines.some((l) => parseBRL(l.price) == null);
  const overStock = useMemo(() => lines.filter((l) => l.qty > l.car.quantity), [lines]);

  const patch = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const remove = (i: number) => setLines((ls) => ls.filter((_, k) => k !== i));

  const copy = async () => {
    await writeText(saleSummary({ buyer, notes, total, items }));
    toast.ok("Resumo copiado — é só colar no WhatsApp.");
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
        items: lines.map((l) => ({ carId: l.car.id, quantity: l.qty, unitPrice: parseBRL(l.price) ?? 0 })),
        updateStock,
      });
      toast.ok(`Venda registrada · ${formatBRL(total)}`);
      await onDone();
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nova venda"
      wide
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn plain" onClick={copy} disabled={!lines.length}>
            <Icon name="copy" /> Copiar resumo
          </button>
          <div className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn primary" onClick={submit} disabled={busy || !lines.length}>
            <Icon name="check" /> {busy ? "Registrando…" : "Registrar venda"}
          </button>
        </>
      }
    >
      <div className="sale-form">
        <div className="sale-left">
          <div className="row two">
            <label className="field">
              <span>Comprador</span>
              <input value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Nome de quem comprou" autoFocus />
            </label>
            <label className="field">
              <span>Contato</span>
              <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="WhatsApp, telefone ou @" />
            </label>
          </div>

          <div className="sale-items">
            {lines.map((l, i) => {
              const img = imageUrl(l.car.imageFile);
              const unit = parseBRL(l.price);
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
                        <span className="adjusted">catálogo {formatBRL(listed)}</span>
                      ) : (
                        <span>{l.car.quantity} em estoque</span>
                      )}
                    </div>
                  </div>
                  <div className="stepper">
                    <button onClick={() => patch(i, { qty: Math.max(1, l.qty - 1) })} disabled={l.qty <= 1} aria-label="Menos 1">
                      <Icon name="minus" size={12} stroke={2.4} />
                    </button>
                    <span>{l.qty}</span>
                    <button onClick={() => patch(i, { qty: l.qty + 1 })} aria-label="Mais 1">
                      <Icon name="plus" size={12} stroke={2.4} />
                    </button>
                  </div>
                  <div className="money small-money">
                    <span>R$</span>
                    <input
                      inputMode="decimal"
                      value={l.price}
                      placeholder="0,00"
                      onChange={(e) => patch(i, { price: e.target.value })}
                      onBlur={() => {
                        const c = parseBRL(l.price);
                        patch(i, { price: c == null ? "" : centsToInput(c) });
                      }}
                    />
                  </div>
                  <button className="icon-btn" onClick={() => remove(i)} title="Tirar da venda">
                    <Icon name="close" size={13} stroke={2.2} />
                  </button>
                </div>
              );
            })}
            {!lines.length && <p className="muted small">Nenhum modelo na venda.</p>}
          </div>

          <label className="field">
            <span>Observação</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Forma de pagamento, entrega, retirada, combinado…"
            />
          </label>
        </div>

        <aside className="sale-summary">
          <div className="sum-row">
            <span>
              {units} {units === 1 ? "item" : "itens"}
            </span>
            <span>{formatBRL(sum)}</span>
          </div>
          <label className="field">
            <span>Valor final</span>
            <div className="money big-money">
              <span>R$</span>
              <input
                inputMode="decimal"
                value={totalInput}
                placeholder={centsToInput(sum)}
                onChange={(e) => setTotalInput(e.target.value)}
                onBlur={() => {
                  const c = parseBRL(totalInput);
                  setTotalInput(c == null || c === sum ? "" : centsToInput(c));
                }}
              />
            </div>
          </label>
          {adj !== 0 && (
            <div className={`sum-adj ${adj < 0 ? "neg" : "pos"}`}>
              {adj < 0 ? "Desconto" : "Acréscimo"} de {formatBRL(Math.abs(adj))}
              <button className="link" onClick={() => setTotalInput("")}>
                desfazer
              </button>
            </div>
          )}
          <div className="sum-total">
            <span>Total</span>
            <strong>{formatBRL(total)}</strong>
          </div>
          <label className="switch">
            <input type="checkbox" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)} />
            <span className="switch-track" />
            Dar baixa no estoque
          </label>
          {updateStock && overStock.length > 0 && (
            <p className="warn small">Mais unidades que o estoque em {overStock.length} modelo(s): o estoque fica em 0.</p>
          )}
          {missingPrice && <p className="warn small">Há modelo sem valor (conta como R$ 0,00).</p>}
        </aside>
      </div>
    </Modal>
  );
}
