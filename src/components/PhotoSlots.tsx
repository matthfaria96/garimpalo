import { Fit, imageUrl, MAX_PHOTOS, Photo, photoFit, PhotoProgress } from "../api";
import FramedImage from "./FramedImage";
import { formatBytes } from "../format";

export type Slot =
  | { kind: "ready"; key: string; photo: Photo; saved?: { from: number; to: number } }
  | { kind: "busy"; key: string; stage: PhotoProgress["stage"] };

const STAGES: Record<PhotoProgress["stage"], { label: string; step: number }> = {
  reading: { label: "Lendo a foto…", step: 1 },
  original: { label: "Corrigindo orientação…", step: 2 },
  compressing: { label: "Comprimindo em WebP…", step: 3 },
  done: { label: "Pronto!", step: 4 },
};

const LABELS = ["Capa", "Foto 2", "Foto 3"];
const HINTS = ["frente da cartela", "verso da caixa", "carrinho / mockup"];

export default function PhotoSlots({
  slots,
  dragOver,
  onAdd,
  onChange,
  onEdit,
  onCopy,
}: {
  slots: Slot[];
  dragOver: boolean;
  onAdd: () => void;
  onChange: (s: Slot[]) => void;
  onEdit: (key: string) => void;
  onCopy: (p: Photo) => void;
}) {
  const move = (i: number, j: number) => {
    const next = [...slots];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const makeCover = (i: number) => onChange([slots[i], ...slots.filter((_, k) => k !== i)]);
  const remove = (i: number) => onChange(slots.filter((_, k) => k !== i));
  const setFit = (i: number, fit: Fit) =>
    onChange(
      slots.map((s, k) =>
        k === i && s.kind === "ready" ? { ...s, photo: { ...s.photo, edits: { ...s.photo.edits, fit } } } : s,
      ),
    );

  return (
    <div className={`photo-slots ${dragOver ? "over" : ""}`}>
      {Array.from({ length: MAX_PHOTOS }, (_, i) => {
        const slot = slots[i];
        const big = i === 0;
        return (
          <div key={slot?.key ?? `empty${i}`} className={`slot ${big ? "slot-cover" : ""}`}>
            {!slot ? (
              i === slots.length ? (
                <button type="button" className="slot-empty" onClick={onAdd}>
                  <span className="slot-plus">＋</span>
                  {big ? (
                    <>
                      <strong>Adicionar fotos</strong>
                      <span>Clique, arraste ou cole (⌘/Ctrl+V) — até {MAX_PHOTOS}</span>
                    </>
                  ) : (
                    <span>{HINTS[i]}</span>
                  )}
                </button>
              ) : (
                <div className="slot-empty disabled">
                  <span>{HINTS[i]}</span>
                </div>
              )
            ) : slot.kind === "busy" ? (
              <div className="slot-busy">
                <span className="spinner" />
                <span className="slot-stage">{STAGES[slot.stage].label}</span>
                <div className="progress">
                  <div style={{ width: `${(STAGES[slot.stage].step / 4) * 100}%` }} />
                </div>
              </div>
            ) : (
              <div className="slot-img">
                <FramedImage src={imageUrl(slot.photo.file) ?? ""} fit={photoFit(slot.photo)} />
                <div className="fit-toggle" title="Como a foto ocupa o card e o catálogo">
                  <button
                    type="button"
                    className={photoFit(slot.photo) === "cover" ? "on" : ""}
                    onClick={() => setFit(i, "cover")}
                    title="Preencher: a foto ocupa o quadro todo"
                  >
                    {big ? "Preencher" : "▣"}
                  </button>
                  <button
                    type="button"
                    className={photoFit(slot.photo) === "blur" ? "on" : ""}
                    onClick={() => setFit(i, "blur")}
                    title="Blur: a foto inteira, com o fundo desfocado"
                  >
                    {big ? "Blur" : "◫"}
                  </button>
                </div>
                {slot.saved && slot.saved.from > 0 && (
                  <span className="saved-chip" title={`${formatBytes(slot.saved.from)} → ${formatBytes(slot.saved.to)}`}>
                    −{Math.max(0, Math.round((1 - slot.saved.to / slot.saved.from) * 100))}% · {formatBytes(slot.saved.to)}
                  </span>
                )}
                <div className="slot-actions">
                  <button type="button" onClick={() => onEdit(slot.key)} title="Recortar, endireitar e ajustar cor">
                    ✎ {big && "Editar"}
                  </button>
                  <button type="button" onClick={() => onCopy(slot.photo)} title="Copiar para colar no WhatsApp">
                    ⧉
                  </button>
                  {!big && (
                    <button type="button" onClick={() => makeCover(i)} title="Usar como capa">
                      ★
                    </button>
                  )}
                  {i > 0 && !big && i + 1 < slots.length && (
                    <button type="button" onClick={() => move(i, i + 1)} title="Mover para a direita">
                      →
                    </button>
                  )}
                  {i > 1 && (
                    <button type="button" onClick={() => move(i, i - 1)} title="Mover para a esquerda">
                      ←
                    </button>
                  )}
                  <button type="button" className="danger-text" onClick={() => remove(i)} title="Remover foto">
                    ✕
                  </button>
                </div>
              </div>
            )}
            <span className="slot-label">{LABELS[i]}</span>
          </div>
        );
      })}
      <p className="muted tiny slot-tip">A capa é a foto que vai no catálogo. As outras ficam para mandar no privado.</p>
    </div>
  );
}
