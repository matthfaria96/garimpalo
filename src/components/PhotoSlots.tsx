import { Fit, imageUrl, MAX_PHOTOS, Photo, photoFit, PhotoProgress } from "../api";
import FramedImage from "./FramedImage";
import { formatBytes } from "../format";
import { L } from "../i18n";

export type Slot =
  | { kind: "ready"; key: string; photo: Photo; saved?: { from: number; to: number } }
  | { kind: "busy"; key: string; stage: PhotoProgress["stage"] };

const STAGES: Record<PhotoProgress["stage"], { label: () => string; step: number }> = {
  reading: { label: () => L("Lendo a foto…", "Reading photo…"), step: 1 },
  original: { label: () => L("Corrigindo orientação…", "Fixing orientation…"), step: 2 },
  compressing: { label: () => L("Comprimindo em WebP…", "Compressing to WebP…"), step: 3 },
  done: { label: () => L("Pronto!", "Done!"), step: 4 },
};

const labels = () => [L("Capa", "Cover"), L("Foto 2", "Photo 2"), L("Foto 3", "Photo 3")];
const hints = () => [
  L("frente da cartela", "front of the card"),
  L("verso da caixa", "back of the box"),
  L("carrinho / mockup", "loose car / mockup"),
];

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

  const LABELS = labels();
  const HINTS = hints();
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
                      <strong>{L("Adicionar fotos", "Add photos")}</strong>
                      <span>
                        {L("Clique, arraste ou cole (⌘/Ctrl+V) — até", "Click, drag or paste (⌘/Ctrl+V) — up to")} {MAX_PHOTOS}
                      </span>
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
                <span className="slot-stage">{STAGES[slot.stage].label()}</span>
                <div className="progress">
                  <div style={{ width: `${(STAGES[slot.stage].step / 4) * 100}%` }} />
                </div>
              </div>
            ) : (
              <div className="slot-img">
                <FramedImage src={imageUrl(slot.photo.file) ?? ""} fit={photoFit(slot.photo)} />
                <div className="fit-toggle" title={L("Como a foto ocupa o card e o catálogo", "How the photo fills the card and the catalog")}>
                  <button
                    type="button"
                    className={photoFit(slot.photo) === "cover" ? "on" : ""}
                    onClick={() => setFit(i, "cover")}
                    title={L("Preencher: a foto ocupa o quadro todo", "Fill: the photo covers the whole frame")}
                  >
                    {big ? L("Preencher", "Fill") : "▣"}
                  </button>
                  <button
                    type="button"
                    className={photoFit(slot.photo) === "blur" ? "on" : ""}
                    onClick={() => setFit(i, "blur")}
                    title={L("Blur: a foto inteira, com o fundo desfocado", "Blur: the whole photo over a blurred background")}
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
                  <button type="button" onClick={() => onEdit(slot.key)} title={L("Recortar, endireitar e ajustar cor", "Crop, straighten and adjust color")}>
                    ✎ {big && L("Editar", "Edit")}
                  </button>
                  <button type="button" onClick={() => onCopy(slot.photo)} title={L("Copiar para colar no WhatsApp", "Copy to paste into WhatsApp")}>
                    ⧉
                  </button>
                  {!big && (
                    <button type="button" onClick={() => makeCover(i)} title={L("Usar como capa", "Use as cover")}>
                      ★
                    </button>
                  )}
                  {i > 0 && !big && i + 1 < slots.length && (
                    <button type="button" onClick={() => move(i, i + 1)} title={L("Mover para a direita", "Move right")}>
                      →
                    </button>
                  )}
                  {i > 1 && (
                    <button type="button" onClick={() => move(i, i - 1)} title={L("Mover para a esquerda", "Move left")}>
                      ←
                    </button>
                  )}
                  <button type="button" className="danger-text" onClick={() => remove(i)} title={L("Remover foto", "Remove photo")}>
                    ✕
                  </button>
                </div>
              </div>
            )}
            <span className="slot-label">{LABELS[i]}</span>
          </div>
        );
      })}
      <p className="muted tiny slot-tip">
        {L(
          "A capa é a foto que vai no catálogo. As outras ficam para mandar no privado.",
          "The cover is the photo used in the catalog. The others are for sending in private chats.",
        )}
      </p>
    </div>
  );
}
