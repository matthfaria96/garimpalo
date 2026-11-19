import { useEffect, useRef, useState } from "react";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { api, Car, errorMessage, MAX_PHOTOS, Photo, PhotoProgress, Processed } from "../api";
import { centsToInput, currencySymbol, discountPercent, formatMoney, parseMoney, todayISO, zeroInput } from "../format";
import { L } from "../i18n";
import Modal from "./Modal";
import PhotoEditor from "./PhotoEditor";
import PhotoSlots, { Slot } from "./PhotoSlots";
import { useToast } from "./Toast";

const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
let slotSeq = 0;
const newKey = () => `s${Date.now()}_${++slotSeq}`;

interface FormState {
  name: string;
  description: string;
  quantity: string;
  acquiredAt: string;
  acquisitionPrice: string;
  salePrice: string;
  promoPrice: string;
}

function fromCar(car: Car | null): FormState {
  return {
    name: car?.name ?? "",
    description: car?.description ?? "",
    quantity: String(car?.quantity ?? 1),
    acquiredAt: car?.acquiredAt ?? todayISO(),
    acquisitionPrice: centsToInput(car?.acquisitionPrice),
    salePrice: centsToInput(car?.salePrice),
    promoPrice: centsToInput(car?.promoPrice),
  };
}

function slotsFrom(car: Car | null): Slot[] {
  return (car?.photos ?? []).map((photo) => ({ kind: "ready", key: newKey(), photo }));
}

export default function CarForm({
  car,
  onClose,
  onSaved,
  onDeleted,
}: {
  car: Car | null;
  onClose: () => void;
  onSaved: (addAnother: boolean) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const toast = useToast();
  const [f, setF] = useState<FormState>(() => fromCar(car));
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<Slot[]>(() => slotsFrom(car));
  const [editing, setEditing] = useState<string | null>(null); // key do slot no editor
  const [dragOver, setDragOver] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const patchSlot = (key: string, fn: (s: Slot) => Slot | null) =>
    setSlots((list) => list.flatMap((s) => (s.key === key ? (fn(s) ?? []) : [s])));

  /** Adiciona fotos (caminhos do disco ou imagens coladas) nos slots livres. */
  const addPhotos = (sources: ({ path: string } | { data: string })[]) => {
    const free = MAX_PHOTOS - slotsRef.current.length;
    if (free <= 0) {
      toast.error(
        L(
          `Máximo de ${MAX_PHOTOS} fotos. Remova uma para adicionar outra.`,
          `Maximum of ${MAX_PHOTOS} photos. Remove one to add another.`,
        ),
      );
      return;
    }
    if (sources.length > free)
      toast.error(
        L(
          `Só cabem mais ${free} foto(s); as demais foram ignoradas.`,
          `Only ${free} more photo(s) fit; the rest were skipped.`,
        ),
      );
    for (const src of sources.slice(0, free)) {
      const key = newKey();
      setSlots((list) => [...list, { kind: "busy", key, stage: "reading" }]);
      const task = "path" in src ? api.photoImportPath(src.path, key) : api.photoImportBase64(src.data, key);
      task
        .then((r: Processed) => {
          patchSlot(key, () => ({ kind: "ready", key, photo: r.photo, saved: { from: r.bytesIn, to: r.bytesOut } }));
          // o selo "−87%" some depois de alguns segundos
          window.setTimeout(() => patchSlot(key, (s) => (s.kind === "ready" ? { ...s, saved: undefined } : s)), 7000);
        })
        .catch((e) => {
          patchSlot(key, () => null);
          toast.error(errorMessage(e));
        });
    }
  };

  const pickFiles = async () => {
    const picked = await open({ multiple: true, filters: [{ name: L("Imagens", "Images"), extensions: IMAGE_EXT }] });
    const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    if (paths.length) addPhotos(paths.map((path) => ({ path })));
  };

  // Etapas da conversão vindas do Rust (lendo → original → comprimindo)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<PhotoProgress>("photo-progress", (ev) => {
      const { token, stage } = ev.payload;
      setSlots((list) => list.map((s) => (s.key === token && s.kind === "busy" ? { ...s, stage } : s)));
    }).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  // Arrastar foto do Finder/Explorer para a janela
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((ev) => {
        const p = ev.payload;
        if (editingRef.current) return;
        if (p.type === "enter" || p.type === "over") setDragOver(true);
        else if (p.type === "leave") setDragOver(false);
        else if (p.type === "drop") {
          setDragOver(false);
          const paths = p.paths.filter((x) => IMAGE_EXT.includes(x.split(".").pop()?.toLowerCase() ?? ""));
          if (paths.length) addPhotos(paths.map((path) => ({ path })));
          else if (p.paths.length) toast.error(L("Arraste imagens (JPG, PNG ou WEBP).", "Drop images (JPG, PNG or WEBP)."));
        }
      })
      .then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  // Colar imagem (Ctrl/Cmd+V), ex.: print ou foto copiada do WhatsApp Web
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (editingRef.current) return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const blob = item?.getAsFile();
      if (!blob) return;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () => addPhotos([{ data: String(reader.result) }]);
      reader.readAsDataURL(blob);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const sale = parseMoney(f.salePrice);
  const promo = parseMoney(f.promoPrice);
  const off = discountPercent(sale, promo);

  const submit = async (addAnother: boolean) => {
    if (!f.name.trim()) {
      toast.error(L("Informe o nome do modelo.", "Enter the model name."));
      nameRef.current?.focus();
      return;
    }
    if (promo != null && sale != null && promo >= sale) {
      toast.error(L("O preço promocional precisa ser menor que o preço de venda.", "The promo price must be lower than the sale price."));
      return;
    }
    if (slots.some((s) => s.kind === "busy")) {
      toast.error(L("Espere as fotos terminarem de converter.", "Wait for the photos to finish converting."));
      return;
    }
    setBusy(true);
    try {
      await api.saveCar({
        id: car?.id,
        name: f.name,
        description: f.description,
        quantity: Math.max(0, parseInt(f.quantity || "0", 10) || 0),
        acquiredAt: f.acquiredAt || null,
        acquisitionPrice: parseMoney(f.acquisitionPrice),
        salePrice: sale,
        promoPrice: sale == null ? null : promo,
        photos: slots.flatMap((s) => (s.kind === "ready" ? [s.photo] : [])),
      });
      toast.ok(
        car
          ? L("Alterações salvas.", "Changes saved.")
          : L(`“${f.name.trim()}” adicionado à garagem.`, `“${f.name.trim()}” added to the garage.`),
      );
      if (addAnother) {
        // mantém data e valor pago (normalmente é o mesmo lote de compra)
        setF((s) => ({ ...fromCar(null), acquiredAt: s.acquiredAt, acquisitionPrice: s.acquisitionPrice }));
        setSlots([]);
        nameRef.current?.focus();
      }
      await onSaved(addAnother);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!car) return;
    const ok = await ask(L(`Excluir “${car.name}” da garagem?`, `Delete “${car.name}” from the garage?`), {
      title: L("Excluir", "Delete"),
      kind: "warning",
      okLabel: L("Excluir", "Delete"),
      cancelLabel: L("Cancelar", "Cancel"),
    });
    if (!ok) return;
    try {
      await api.deleteCar(car.id);
      toast.ok(L("Modelo excluído.", "Model deleted."));
      await onDeleted();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const editingSlot = slots.find((s) => s.key === editing && s.kind === "ready");

  return (
    <Modal
      title={car ? L("Editar modelo", "Edit model") : L("Novo modelo", "New model")}
      onClose={() => (editingRef.current ? setEditing(null) : onClose())}
      wide
      footer={
        <>
          {car && (
            <button className="btn ghost danger-text" onClick={remove} disabled={busy}>
              {L("Excluir", "Delete")}
            </button>
          )}
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {L("Cancelar", "Cancel")}
          </button>
          {!car && (
            <button className="btn ghost" onClick={() => submit(true)} disabled={busy}>
              {L("Salvar e adicionar outro", "Save and add another")}
            </button>
          )}
          <button className="btn primary" onClick={() => submit(false)} disabled={busy}>
            {L("Salvar", "Save")}
          </button>
        </>
      }
    >
      <form
        className="car-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <PhotoSlots
          slots={slots}
          dragOver={dragOver}
          onAdd={pickFiles}
          onChange={setSlots}
          onEdit={(key) => setEditing(key)}
          onCopy={async (photo: Photo) => {
            try {
              await api.copyPhoto(photo.file);
              toast.ok(L("Foto copiada — é só colar no WhatsApp.", "Photo copied — just paste it into WhatsApp."));
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
        />

        <div className="fields">
          <label className="field">
            <span>{L("Nome do modelo *", "Model name *")}</span>
            <input
              ref={nameRef}
              value={f.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={L("Ex.: Porsche 911 Carrera RS 2.7", "e.g. Porsche 911 Carrera RS 2.7")}
              autoFocus
            />
          </label>
          <label className="field">
            <span>{L("Descrição", "Description")}</span>
            <textarea
              rows={3}
              value={f.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={L("Cor, série, nº na coleção, TH/STH, estado da cartela…", "Color, series, collection #, TH/STH, card condition…")}
            />
          </label>
          <div className="row">
            <label className="field">
              <span>{L("Quantidade", "Quantity")}</span>
              <input
                type="number"
                min={0}
                value={f.quantity}
                onChange={(e) => set("quantity", e.target.value)}
              />
            </label>
            <label className="field">
              <span>{L("Data da aquisição", "Date acquired")}</span>
              <input type="date" value={f.acquiredAt} onChange={(e) => set("acquiredAt", e.target.value)} />
            </label>
            <label className="field">
              <span>{L("Valor pago (unidade)", "Price paid (each)")}</span>
              <MoneyInput value={f.acquisitionPrice} onChange={(v) => set("acquisitionPrice", v)} />
            </label>
          </div>
          <div className="row">
            <label className="field">
              <span>{L("Preço de venda", "Sale price")}</span>
              <MoneyInput value={f.salePrice} onChange={(v) => set("salePrice", v)} />
            </label>
            <label className="field">
              <span>{L("Preço promocional (opcional)", "Promo price (optional)")}</span>
              <MoneyInput value={f.promoPrice} onChange={(v) => set("promoPrice", v)} disabled={sale == null} />
            </label>
            <div className="field field-note">
              {off != null ? (
                <span className="promo-note">
                  -{off}% · {L("de", "was")} {formatMoney(sale)} {L("por", "now")} {formatMoney(promo)}
                </span>
              ) : (
                <span className="muted small">
                  {L(
                    "Com preço promocional o catálogo mostra “de / por” e o selo de desconto.",
                    "With a promo price the catalog shows the old price struck through and a discount badge.",
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
        <button type="submit" hidden />
      </form>
      {editingSlot && editingSlot.kind === "ready" && (
        <PhotoEditor
          photo={editingSlot.photo}
          onClose={() => setEditing(null)}
          onApply={(r) => {
            patchSlot(editingSlot.key, () => ({ kind: "ready", key: editingSlot.key, photo: r.photo }));
            setEditing(null);
            toast.ok(`${L("Foto ajustada", "Photo adjusted")} · ${Math.round(r.bytesOut / 1024)} KB`);
          }}
        />
      )}
    </Modal>
  );
}

function MoneyInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`money ${disabled ? "disabled" : ""}`}>
      <span>{currencySymbol()}</span>
      <input
        inputMode="decimal"
        value={value}
        disabled={disabled}
        placeholder={zeroInput()}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const c = parseMoney(value);
          onChange(c == null ? "" : centsToInput(c));
        }}
      />
    </div>
  );
}
