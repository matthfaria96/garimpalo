import { useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { api, Car, coverFit, errorMessage, imageUrl } from "../api";
import Icon from "./Icon";
import FramedImage from "./FramedImage";
import { discountPercent, finalPrice, formatMoney, formatDate, moneyParts, normalize } from "../format";
import { L, locale, P } from "../i18n";
import CarForm from "./CarForm";
import SaleForm from "./SaleForm";
import { useToast } from "./Toast";

type Sort = "recent" | "name" | "acquired" | "price" | "qty";

export default function Garage({
  cars,
  selected,
  onSelectedChange,
  onBack,
  onCatalog,
  onChanged,
}: {
  cars: Car[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  onBack: () => void;
  onCatalog: () => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [onlyStock, setOnlyStock] = useState(false);
  const [editing, setEditing] = useState<Car | "new" | null>(null);
  const [selling, setSelling] = useState(false);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const visible = useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    let list = cars.filter((c) => {
      if (onlyStock && c.quantity <= 0) return false;
      if (!terms.length) return true;
      const hay = normalize(`${c.name} ${c.description}`);
      return terms.every((t) => hay.includes(t));
    });
    const byName = (a: Car, b: Car) => a.name.localeCompare(b.name, locale());
    list = [...list];
    switch (sort) {
      case "name":
        list.sort(byName);
        break;
      case "acquired":
        list.sort((a, b) => (b.acquiredAt ?? "").localeCompare(a.acquiredAt ?? ""));
        break;
      case "price":
        list.sort(
          (a, b) =>
            (finalPrice(b.salePrice, b.promoPrice) ?? -1) -
            (finalPrice(a.salePrice, a.promoPrice) ?? -1),
        );
        break;
      case "qty":
        list.sort((a, b) => b.quantity - a.quantity || byName(a, b));
        break;
    }
    return list;
  }, [cars, query, sort, onlyStock]);

  const totals = useMemo(() => {
    let units = 0;
    let invested = 0;
    for (const c of cars) {
      units += c.quantity;
      invested += (c.acquisitionPrice ?? 0) * c.quantity;
    }
    return { units, invested };
  }, [cars]);

  const toggle = (id: string) =>
    onSelectedChange(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  const selectAllVisible = () => {
    const add = visible.map((c) => c.id).filter((id) => !selectedSet.has(id));
    onSelectedChange([...selected, ...add]);
  };

  const changeQty = async (car: Car, delta: number) => {
    try {
      await api.updateQuantity(car.id, Math.max(0, car.quantity + delta));
      await onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const deleteSelected = async () => {
    const ok = await ask(
      L(
        `Excluir ${selected.length} modelo(s) da garagem? Não dá pra desfazer.`,
        `Delete ${selected.length} model(s) from the garage? This can't be undone.`,
      ),
      {
        title: L("Excluir", "Delete"),
        kind: "warning",
        okLabel: L("Excluir", "Delete"),
        cancelLabel: L("Cancelar", "Cancel"),
      },
    );
    if (!ok) return;
    try {
      for (const id of selected) await api.deleteCar(id);
      onSelectedChange([]);
      await onChanged();
      toast.ok(L("Modelos excluídos.", "Models deleted."));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="page garage">
      <header className="topbar" data-tauri-drag-region>
        <div className="topbar-left" data-tauri-drag-region>
          <button className="btn back" onClick={onBack}>
            <Icon name="back" /> {L("Coleções", "Collections")}
          </button>
          <div className="title-block" data-tauri-drag-region>
            <h1>Hot Wheels</h1>
            <span className="subtitle">
              {P(cars.length, ["modelo", "modelos"], ["model", "models"])} ·{" "}
              {P(totals.units, ["unidade", "unidades"], ["unit", "units"])} · {formatMoney(totals.invested)}{" "}
              {L("investido", "invested")}
            </span>
          </div>
        </div>
        <div className="topbar-actions">
          <label className="search-field">
            <Icon name="search" size={15} />
            <input
              className="search"
              placeholder={L("Buscar modelo, cor, série…", "Search model, color, series…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button className="search-clear" onClick={() => setQuery("")} aria-label={L("Limpar busca", "Clear search")}>
                <Icon name="close" size={11} stroke={2.6} />
              </button>
            )}
          </label>
          <button className="btn primary" onClick={() => setEditing("new")}>
            <Icon name="plus" /> {L("Adicionar", "Add")}
          </button>
        </div>
      </header>

      <div className="toolbar">
        <span className="toolbar-count">
          {visible.length === cars.length
            ? P(cars.length, ["modelo", "modelos"], ["model", "models"])
            : `${visible.length} ${L("de", "of")} ${cars.length}`}
        </span>
        <div className="spacer" />
        <label className="switch">
          <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} />
          <span className="switch-track" />
          {L("Só com estoque", "In stock only")}
        </label>
        <select className="popup" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="recent">{L("Mais recentes", "Most recent")}</option>
          <option value="name">{L("Nome (A–Z)", "Name (A–Z)")}</option>
          <option value="acquired">{L("Data de aquisição", "Date acquired")}</option>
          <option value="price">{L("Preço de venda", "Sale price")}</option>
          <option value="qty">{L("Quantidade", "Quantity")}</option>
        </select>
        <button className="btn small" onClick={selectAllVisible} disabled={!visible.length}>
          {query || onlyStock ? L("Selecionar filtrados", "Select filtered") : L("Selecionar todos", "Select all")}
        </button>
      </div>

      {cars.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="sparkle" size={30} stroke={1.5} />
          </div>
          <h2>{L("Sua garagem está vazia", "Your garage is empty")}</h2>
          <p>{L("Cadastre o primeiro carrinho com foto e preço.", "Add your first car with a photo and a price.")}</p>
          <button className="btn primary" onClick={() => setEditing("new")}>
            {L("Adicionar o primeiro carrinho", "Add the first car")}
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p>
            {L("Nada encontrado para", "Nothing found for")} “{query}”.
          </p>
        </div>
      ) : (
        <div className="grid">
          {visible.map((car) => {
            const img = imageUrl(car.imageFile);
            const isSel = selectedSet.has(car.id);
            const off = discountPercent(car.salePrice, car.promoPrice);
            return (
              <div key={car.id} className={`car-card ${isSel ? "selected" : ""} ${car.quantity <= 0 ? "out" : ""}`}>
                <div className="car-img" onClick={() => toggle(car.id)} title={L("Clique para selecionar", "Click to select")}>
                  {img ? <FramedImage src={img} fit={coverFit(car)} lazy /> : <span className="no-img">{L("sem foto", "no photo")}</span>}
                  <span className={`sel-box ${isSel ? "on" : ""}`}>{isSel && <Icon name="check" size={14} stroke={3} />}</span>
                  {off != null && <span className="off-badge">-{off}%</span>}
                  {car.photos.length > 1 && (
                    <span className="photo-count" title={`${car.photos.length} ${L("fotos", "photos")}`}>
                      <Icon name="photos" size={12} stroke={2.2} /> {car.photos.length}
                    </span>
                  )}
                </div>
                <div className="car-info" onClick={() => setEditing(car)} title={L("Clique para editar", "Click to edit")}>
                  <div className="car-name">{car.name}</div>
                  <Price sale={car.salePrice} promo={car.promoPrice} />
                  <div className="car-meta">
                    {car.acquiredAt && <span>{formatDate(car.acquiredAt)}</span>}
                    {car.acquisitionPrice != null && <span>
                        {L("pago", "paid")} {formatMoney(car.acquisitionPrice)}
                      </span>}
                  </div>
                </div>
                <div className="car-qty">
                  <button onClick={() => changeQty(car, -1)} disabled={car.quantity <= 0} title={L("Vendi / tirei 1", "Sold / removed 1")}>
                    <Icon name="minus" size={13} stroke={2.4} />
                  </button>
                  <span>
                    {car.quantity}{" "}
                    <small>{car.quantity === 1 ? L("unidade", "unit") : L("unidades", "units")}</small>
                  </span>
                  <button onClick={() => changeQty(car, 1)} title={L("Mais 1", "Add 1")}>
                    <Icon name="plus" size={13} stroke={2.4} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected.length > 0 && (
        <div className="selection-bar">
          <span className="sel-count">{selected.length}</span>
          <span className="sel-label">{L(selected.length === 1 ? "selecionado" : "selecionados", "selected")}</span>
          <button className="btn plain small" onClick={() => onSelectedChange([])}>
            {L("Limpar", "Clear")}
          </button>
          <button className="btn plain small danger-text" onClick={deleteSelected}>
            <Icon name="trash" size={14} /> {L("Excluir", "Delete")}
          </button>
          <div className="spacer" />
          <button className="btn" onClick={() => setSelling(true)}>
            <Icon name="bag" size={15} /> {L("Gerar venda", "Record sale")}
          </button>
          <button className="btn primary" onClick={onCatalog}>
            {L("Gerar catálogo", "Create catalog")} <Icon name="arrow" size={15} />
          </button>
        </div>
      )}

      {selling && (
        <SaleForm
          cars={selected.map((id) => cars.find((c) => c.id === id)).filter((c): c is Car => !!c)}
          onClose={() => setSelling(false)}
          onDone={async () => {
            setSelling(false);
            onSelectedChange([]);
            await onChanged();
          }}
        />
      )}

      {editing && (
        <CarForm
          car={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (again) => {
            await onChanged();
            if (!again) setEditing(null);
          }}
          onDeleted={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Preço como no catálogo: "R$" pequeno e número grande; na promoção fica vermelho e o antigo vai riscado. */
function Price({ sale, promo }: { sale: number | null; promo: number | null }) {
  const off = discountPercent(sale, promo);
  const now = off != null ? promo : finalPrice(sale, promo);
  if (now == null) {
    return (
      <div className="price">
        <span className="price-ask">{L("Consulte o preço", "Ask for price")}</span>
      </div>
    );
  }
  const { cur, num } = moneyParts(now);
  return (
    <div className="price">
      <span className={`price-now ${off != null ? "promo" : ""}`}>
        <small>{cur}</small>
        {num}
      </span>
      {off != null && <span className="price-old">{formatMoney(sale)}</span>}
    </div>
  );
}
