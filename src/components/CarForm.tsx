import { useEffect, useRef, useState } from "react";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { api, Car, errorMessage, MAX_PHOTOS, Photo, PhotoProgress, Processed } from "../api";
import { centsToInput, discountPercent, formatBRL, parseBRL, todayISO } from "../format";
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
      toast.error(`Máximo de ${MAX_PHOTOS} fotos. Remova uma para adicionar outra.`);
      return;
    }
    if (sources.length > free) toast.error(`Só cabem mais ${free} foto(s); as demais foram ignoradas.`);
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
    const picked = await open({ multiple: true, filters: [{ name: "Imagens", extensions: IMAGE_EXT }] });
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
          else if (p.paths.length) toast.error("Arraste imagens (JPG, PNG ou WEBP).");
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

  const sale = parseBRL(f.salePrice);
  const promo = parseBRL(f.promoPrice);
  const off = discountPercent(sale, promo);

  const submit = async (addAnother: boolean) => {
    if (!f.name.trim()) {
      toast.error("Informe o nome do modelo.");
      nameRef.current?.focus();
      return;
    }
    if (promo != null && sale != null && promo >= sale) {
      toast.error("O preço promocional precisa ser menor que o preço de venda.");
      return;
    }
    if (slots.some((s) => s.kind === "busy")) {
      toast.error("Espere as fotos terminarem de converter.");
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
        acquisitionPrice: parseBRL(f.acquisitionPrice),
        salePrice: sale,
        promoPrice: sale == null ? null : promo,
        photos: slots.flatMap((s) => (s.kind === "ready" ? [s.photo] : [])),
      });
      toast.ok(car ? "Alterações salvas." : `“${f.name.trim()}” adicionado à garagem.`);
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
    const ok = await ask(`Excluir “${car.name}” da garagem?`, {
      title: "Excluir",
      kind: "warning",
      okLabel: "Excluir",
      cancelLabel: "Cancelar",
    });
    if (!ok) return;
    try {
      await api.deleteCar(car.id);
      toast.ok("Modelo excluído.");
      await onDeleted();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const editingSlot = slots.find((s) => s.key === editing && s.kind === "ready");

  return (
    <Modal
      title={car ? "Editar modelo" : "Novo modelo"}
      onClose={() => (editingRef.current ? setEditing(null) : onClose())}
      wide
      footer={
        <>
          {car && (
            <button className="btn ghost danger-text" onClick={remove} disabled={busy}>
              Excluir
            </button>
          )}
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          {!car && (
            <button className="btn ghost" onClick={() => submit(true)} disabled={busy}>
              Salvar e adicionar outro
            </button>
          )}
          <button className="btn primary" onClick={() => submit(false)} disabled={busy}>
            Salvar
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
              toast.ok("Foto copiada — é só colar no WhatsApp.");
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
        />

        <div className="fields">
          <label className="field">
            <span>Nome do modelo *</span>
            <input
              ref={nameRef}
              value={f.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Ex.: Porsche 911 Carrera RS 2.7"
              autoFocus
            />
          </label>
          <label className="field">
            <span>Descrição</span>
            <textarea
              rows={3}
              value={f.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Cor, série, nº na coleção, TH/STH, estado da cartela…"
            />
          </label>
          <div className="row">
            <label className="field">
              <span>Quantidade</span>
              <input
                type="number"
                min={0}
                value={f.quantity}
                onChange={(e) => set("quantity", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Data da aquisição</span>
              <input type="date" value={f.acquiredAt} onChange={(e) => set("acquiredAt", e.target.value)} />
            </label>
            <label className="field">
              <span>Valor pago (unidade)</span>
              <MoneyInput value={f.acquisitionPrice} onChange={(v) => set("acquisitionPrice", v)} />
            </label>
          </div>
          <div className="row">
            <label className="field">
              <span>Preço de venda</span>
              <MoneyInput value={f.salePrice} onChange={(v) => set("salePrice", v)} />
            </label>
            <label className="field">
              <span>Preço promocional (opcional)</span>
              <MoneyInput value={f.promoPrice} onChange={(v) => set("promoPrice", v)} disabled={sale == null} />
            </label>
            <div className="field field-note">
              {off != null ? (
                <span className="promo-note">
                  -{off}% · de {formatBRL(sale)} por {formatBRL(promo)}
                </span>
              ) : (
                <span className="muted small">Com preço promocional o catálogo mostra “de / por” e o selo de desconto.</span>
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
            toast.ok(`Foto ajustada · ${Math.round(r.bytesOut / 1024)} KB`);
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
      <span>R$</span>
      <input
        inputMode="decimal"
        value={value}
        disabled={disabled}
        placeholder="0,00"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const c = parseBRL(value);
          onChange(c == null ? "" : centsToInput(c));
        }}
      />
    </div>
  );
}
