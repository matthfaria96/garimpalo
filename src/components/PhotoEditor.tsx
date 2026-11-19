import { PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { api, Edits, errorMessage, Fit, NEUTRAL_EDITS, Photo, photoFit, Processed, Quad } from "../api";
import FramedImage from "./FramedImage";
import { useToast } from "./Toast";
import { L } from "../i18n";

type Pt = [number, number];
type Tab = "crop" | "color";
type Aspect = "free" | "3:4" | "1:1" | "4:3";

const FULL: Quad = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const ASPECTS: { key: Aspect; label: string; ratio: number | null }[] = [
  {
    key: "free",
    get label() {
      return L("Livre", "Free");
    },
    ratio: null,
  },
  { key: "3:4", label: "3:4", ratio: 3 / 4 },
  { key: "1:1", label: "1:1", ratio: 1 },
  { key: "4:3", label: "4:3", ratio: 4 / 3 },
];
const SLIDERS: { key: keyof Edits; label: string; min: number; hint?: string }[] = [
  slider("brightness", ["Brilho", "Brightness"], -100),
  slider("contrast", ["Contraste", "Contrast"], -100),
  slider("vibrance", ["Vibração", "Vibrance"], -100, [
    "Realça cores apagadas sem estourar as fortes",
    "Boosts dull colors without blowing out strong ones",
  ]),
  slider("saturation", ["Saturação", "Saturation"], -100),
  slider("temperature", ["Temperatura", "Temperature"], -100, ["← mais frio · mais quente →", "← cooler · warmer →"]),
  slider("sharpness", ["Nitidez", "Sharpness"], 0),
];
/** Rótulos são lidos na hora (idioma atual). */
function slider(key: keyof Edits, label: [string, string], min: number, hint?: [string, string]) {
  return {
    key,
    min,
    get label() {
      return L(...label);
    },
    get hint() {
      return hint && L(...hint);
    },
  };
}
const MIN_SIZE = 0.04;
const SOURCE_MAX = 1100;
const PREVIEW_MAX = 1000;
const LOUPE = 128;
const ZOOM = 3;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const isFull = (q: Quad) => q.every(([x, y], i) => Math.abs(x - FULL[i][0]) < 1e-4 && Math.abs(y - FULL[i][1]) < 1e-4);

function rectFrom(a: Pt, b: Pt): Quad {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

function bbox(q: Quad): Quad {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  return rectFrom([Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]);
}

/** Convexo e no sentido horário na tela (mesma regra do Rust/PhotoCraft). */
function isConvex(q: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const [a, b, c] = [q[i], q[(i + 1) % 4], q[(i + 2) % 4]];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross <= 1e-5) return false;
  }
  return true;
}

/** Gira os cantos junto com a foto, para o recorte acompanhar. */
function rotateQuad(q: Quad, dir: 1 | -1): Quad {
  if (dir === 1) {
    const r = (p: Pt): Pt => [1 - p[1], p[0]];
    return [r(q[3]), r(q[0]), r(q[1]), r(q[2])];
  }
  const r = (p: Pt): Pt => [p[1], 1 - p[0]];
  return [r(q[1]), r(q[2]), r(q[3]), r(q[0])];
}

/** Retângulo centrado no atual com a proporção pedida (em pixels). */
function fitAspect(q: Quad, ratio: number, imgAspect: number): Quad {
  const b = bbox(q);
  let w = b[1][0] - b[0][0];
  let h = b[2][1] - b[0][1];
  const cx = b[0][0] + w / 2;
  const cy = b[0][1] + h / 2;
  if ((w * imgAspect) / h > ratio) w = (ratio * h) / imgAspect;
  else h = (w * imgAspect) / ratio;
  const k = Math.min(1, 1 / w, 1 / h);
  w *= k;
  h *= k;
  const x0 = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  const y0 = Math.min(Math.max(cy - h / 2, 0), 1 - h);
  return rectFrom([x0, y0], [x0 + w, y0 + h]);
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

type Drag =
  | { kind: "corner"; index: number; anchor: Pt }
  | { kind: "move"; start: Pt; quad: Quad };

export default function PhotoEditor({
  photo,
  onClose,
  onApply,
}: {
  photo: Photo;
  onClose: () => void;
  onApply: (p: Processed) => void;
}) {
  const toast = useToast();
  const [edits, setEdits] = useState<Edits>(() => ({
    ...NEUTRAL_EDITS,
    ...photo.edits,
    cropMode: photo.edits?.cropMode || "rect",
    fit: photoFit(photo),
  }));
  const [tab, setTab] = useState<Tab>("crop");
  const [aspect, setAspect] = useState<Aspect>("free");
  const [source, setSource] = useState<{ url: string; width: number; height: number } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const quad = edits.quad ?? FULL;
  const perspective = edits.cropMode === "perspective";
  const ratio = ASPECTS.find((a) => a.key === aspect)?.ratio ?? null;
  const imgAspect = source ? source.width / source.height : 1;

  const fit: Fit = edits.fit === "blur" ? "blur" : "cover";
  /** O que muda os pixels (o modo de exibição fica de fora: trocar Preencher/Blur não gera nova prévia). */
  const { fit: _fit, ...pixelEdits } = edits;
  const pixelKey = JSON.stringify(pixelEdits);
  /** O que vai para o Rust: sem recorte se o quadro cobre a imagem toda. */
  const renderEdits = useMemo<Edits>(
    () => ({ ...pixelEdits, quad: edits.quad && !isFull(edits.quad) ? edits.quad : null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pixelKey],
  );

  // Original girado (o recorte é desenhado em cima dele)
  useEffect(() => {
    let alive = true;
    setSource(null);
    api
      .photoSource(photo.original, edits.rotate, SOURCE_MAX)
      .then((s) => alive && setSource(s))
      .catch((e) => toast.error(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [photo.original, edits.rotate]);

  // Prévia do resultado (com um pequeno atraso para não renderizar a cada pixel arrastado)
  useEffect(() => {
    if (drag) return; // espera soltar o canto
    const id = ++seq.current;
    setPreviewBusy(true);
    const t = window.setTimeout(() => {
      api
        .photoPreview(photo.original, renderEdits, PREVIEW_MAX)
        .then((url) => id === seq.current && setPreview(url))
        .catch((e) => id === seq.current && toast.error(errorMessage(e)))
        .finally(() => id === seq.current && setPreviewBusy(false));
    }, 120);
    return () => window.clearTimeout(t);
  }, [renderEdits, drag, photo.original]);

  // Tamanho da imagem na tela (cabe no palco mantendo a proporção)
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width - 48, h: r.height - 48 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const display = useMemo(() => {
    if (!source || box.w <= 0 || box.h <= 0) return null;
    const s = Math.min(box.w / source.width, box.h / source.height);
    return { w: Math.round(source.width * s), h: Math.round(source.height * s) };
  }, [source, box]);

  const setQuad = (q: Quad | null) => setEdits((e) => ({ ...e, quad: q }));
  const set = (k: keyof Edits, v: number) => setEdits((e) => ({ ...e, [k]: v }));

  const toPoint = (ev: { clientX: number; clientY: number }): Pt => {
    const r = innerRef.current!.getBoundingClientRect();
    return [clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height)];
  };

  const startCorner = (i: number) => (ev: ReactPointerEvent) => {
    ev.stopPropagation();
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    setDrag({ kind: "corner", index: i, anchor: quad[(i + 2) % 4] });
    setPointer(quad[i]);
  };

  const startMove = (ev: ReactPointerEvent) => {
    if (isFull(quad)) return;
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    setDrag({ kind: "move", start: toPoint(ev), quad });
  };

  const onMove = (ev: ReactPointerEvent) => {
    if (!drag) return;
    const p = toPoint(ev);
    if (drag.kind === "move") {
      const xs = drag.quad.map((c) => c[0]);
      const ys = drag.quad.map((c) => c[1]);
      const dx = Math.min(Math.max(p[0] - drag.start[0], -Math.min(...xs)), 1 - Math.max(...xs));
      const dy = Math.min(Math.max(p[1] - drag.start[1], -Math.min(...ys)), 1 - Math.max(...ys));
      setQuad(drag.quad.map(([x, y]) => [x + dx, y + dy]) as Quad);
      return;
    }
    setPointer(p);
    if (perspective) {
      const next = quad.map((c, i) => (i === drag.index ? p : c)) as Quad;
      if (isConvex(next)) setQuad(next);
      return;
    }
    // Retângulo: o canto oposto fica parado; com proporção travada
    const o = drag.anchor;
    const sx = Math.sign(p[0] - o[0]) || 1;
    const sy = Math.sign(p[1] - o[1]) || 1;
    let ax = Math.max(Math.abs(p[0] - o[0]), MIN_SIZE);
    let ay = Math.max(Math.abs(p[1] - o[1]), MIN_SIZE);
    const maxX = sx > 0 ? 1 - o[0] : o[0];
    const maxY = sy > 0 ? 1 - o[1] : o[1];
    if (ratio) {
      if ((ax * imgAspect) / ay > ratio) ax = (ratio * ay) / imgAspect;
      else ay = (ax * imgAspect) / ratio;
      const k = Math.min(1, maxX / ax, maxY / ay);
      ax *= k;
      ay *= k;
    } else {
      ax = Math.min(ax, maxX);
      ay = Math.min(ay, maxY);
    }
    setQuad(rectFrom(o, [o[0] + sx * ax, o[1] + sy * ay]));
  };

  const endDrag = () => {
    setDrag(null);
    setPointer(null);
  };

  const rotate = (dir: 1 | -1) =>
    setEdits((e) => ({
      ...e,
      rotate: (e.rotate + (dir === 1 ? 90 : 270)) % 360,
      quad: e.quad ? rotateQuad(e.quad, dir) : null,
    }));

  const setMode = (mode: "rect" | "perspective") =>
    setEdits((e) => ({ ...e, cropMode: mode, quad: mode === "rect" && e.quad ? bbox(e.quad) : e.quad }));

  const chooseAspect = (a: Aspect) => {
    setAspect(a);
    const r = ASPECTS.find((x) => x.key === a)?.ratio;
    if (r) setEdits((e) => ({ ...e, cropMode: "rect", quad: fitAspect(e.quad ?? FULL, r, imgAspect) }));
  };

  const apply = async () => {
    setApplying(true);
    try {
      onApply(await api.photoRender(photo.original, { ...renderEdits, fit }));
    } catch (e) {
      toast.error(errorMessage(e));
      setApplying(false);
    }
  };

  const colorChanged = SLIDERS.some((s) => edits[s.key] !== 0);

  // Guias: terços no retângulo; malha em perspectiva (ajuda a alinhar com a caixa)
  const guides = useMemo(() => {
    const lines: [Pt, Pt][] = [];
    for (const t of [1 / 3, 2 / 3]) {
      lines.push([lerp(quad[0], quad[1], t), lerp(quad[3], quad[2], t)]);
      lines.push([lerp(quad[0], quad[3], t), lerp(quad[1], quad[2], t)]);
    }
    return lines;
  }, [quad]);

  const loupe =
    drag?.kind === "corner" && pointer && display && source ? (
      <div
        className="loupe"
        style={{
          left: pointer[0] * display.w + (pointer[0] > 0.5 ? -LOUPE - 24 : 24),
          top: pointer[1] * display.h + (pointer[1] > 0.5 ? -LOUPE - 24 : 24),
          width: LOUPE,
          height: LOUPE,
          backgroundImage: `url(${source.url})`,
          backgroundSize: `${display.w * ZOOM}px ${display.h * ZOOM}px`,
          backgroundPosition: `${-(pointer[0] * display.w * ZOOM - LOUPE / 2)}px ${-(pointer[1] * display.h * ZOOM - LOUPE / 2)}px`,
        }}
      />
    ) : null;

  return (
    <div className="editor-backdrop">
      <div className="editor">
        <header className="editor-head">
          <div className="segmented small-seg">
            <button className={tab === "crop" ? "on" : ""} onClick={() => setTab("crop")}>
              ✂ {L("Recorte e ângulo", "Crop & angle")}
            </button>
            <button className={tab === "color" ? "on" : ""} onClick={() => setTab("color")}>
              ◐ {L("Cor e luz", "Color & light")}
            </button>
          </div>
          <div className="spacer" />
          <button className="icon-btn close-btn" onClick={onClose} disabled={applying} aria-label={L("Fechar", "Close")}>
            <Icon name="close" size={14} stroke={2.2} />
          </button>
        </header>

        <div className="editor-body">
          <div className="editor-stage" ref={stageRef}>
            {tab === "crop" ? (
              source && display ? (
                <div
                  className="stage-inner"
                  ref={innerRef}
                  style={{ width: display.w, height: display.h }}
                  onPointerMove={onMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <img src={source.url} alt="" draggable={false} />
                  <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="crop-svg">
                    <path
                      className="crop-shade"
                      fillRule="evenodd"
                      d={`M0 0H1V1H0Z M${quad.map((p) => p.join(" ")).join(" L")} Z`}
                    />
                    {guides.map(([a, b], i) => (
                      <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="crop-guide" />
                    ))}
                    <polygon
                      points={quad.map((p) => p.join(",")).join(" ")}
                      className={`crop-frame ${drag?.kind === "move" ? "moving" : ""}`}
                      onPointerDown={startMove}
                    />
                  </svg>
                  {quad.map((p, i) => (
                    <div
                      key={i}
                      className={`crop-handle ${perspective ? "persp" : ""}`}
                      style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }}
                      onPointerDown={startCorner(i)}
                    />
                  ))}
                  {loupe}
                </div>
              ) : (
                <Spinner text={L("Abrindo foto…", "Opening photo…")} />
              )
            ) : preview ? (
              <div className="stage-preview">
                <img src={preview} alt="" />
                {previewBusy && <span className="busy-dot" />}
              </div>
            ) : (
              <Spinner text={L("Gerando prévia…", "Rendering preview…")} />
            )}
          </div>

          <aside className="editor-side">
            {tab === "crop" ? (
              <>
                <section>
                  <h3>{L("Modo", "Mode")}</h3>
                  <div className="segmented">
                    <button className={!perspective ? "on" : ""} onClick={() => setMode("rect")}>
                      {L("Retângulo", "Rectangle")}
                      <small>{L("recorte normal", "regular crop")}</small>
                    </button>
                    <button className={perspective ? "on" : ""} onClick={() => setMode("perspective")}>
                      {L("Perspectiva", "Perspective")}
                      <small>{L("endireitar a caixa", "straighten the box")}</small>
                    </button>
                  </div>
                  {perspective ? (
                    <p className="muted small">
                      {L(
                        "Arraste cada canto até a quina da cartela. O app endireita a foto como se ela tivesse sido tirada de frente.",
                        "Drag each corner to a corner of the card. The app straightens the photo as if it had been taken head-on.",
                      )}
                    </p>
                  ) : (
                    <div className="chips">
                      {ASPECTS.map((a) => (
                        <button key={a.key} className={aspect === a.key ? "on" : ""} onClick={() => chooseAspect(a.key)}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
                <section>
                  <h3>{L("Girar", "Rotate")}</h3>
                  <div className="row-btns">
                    <button className="btn ghost" onClick={() => rotate(-1)}>
                      ↺ 90°
                    </button>
                    <button className="btn ghost" onClick={() => rotate(1)}>
                      ↻ 90°
                    </button>
                    <button className="btn ghost" onClick={() => setQuad(null)} disabled={isFull(quad)}>
                      {L("Sem recorte", "No crop")}
                    </button>
                  </div>
                </section>
                <FitSection fit={fit} preview={preview} busy={previewBusy} onFit={(f) => setEdits((e) => ({ ...e, fit: f }))} />
              </>
            ) : (
              <>
                {SLIDERS.map((s) => (
                  <label key={s.key} className="slider" onDoubleClick={() => set(s.key, 0)} title={L("Duplo clique para zerar", "Double-click to reset")}>
                    <span className="slider-head">
                      {s.label}
                      <b>{(edits[s.key] as number) > 0 && s.min < 0 ? "+" : ""}{edits[s.key] as number}</b>
                    </span>
                    <input
                      type="range"
                      min={s.min}
                      max={100}
                      value={edits[s.key] as number}
                      onChange={(e) => set(s.key, Number(e.target.value))}
                      className={s.key === "temperature" ? "temp" : ""}
                    />
                    {s.hint && <span className="muted tiny">{s.hint}</span>}
                  </label>
                ))}
                <FitSection fit={fit} preview={preview} busy={previewBusy} onFit={(f) => setEdits((e) => ({ ...e, fit: f }))} />
                <button
                  className="btn ghost small"
                  disabled={!colorChanged}
                  onClick={() => setEdits((e) => ({ ...e, ...Object.fromEntries(SLIDERS.map((s) => [s.key, 0])) }))}
                >
                  {L("Zerar cor e luz", "Reset color & light")}
                </button>
              </>
            )}
          </aside>
        </div>

        <footer className="editor-foot">
          <button
            className="btn ghost"
            disabled={applying}
            onClick={() => setEdits((e) => ({ ...NEUTRAL_EDITS, fit: e.fit }))}
            title={L("Volta a foto original, sem nenhum ajuste", "Back to the original photo, with no adjustments")}
          >
            {L("Restaurar original", "Restore original")}
          </button>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose} disabled={applying}>
            {L("Cancelar", "Cancel")}
          </button>
          <button className="btn primary" onClick={apply} disabled={applying || !source}>
            {L("Aplicar", "Apply")}
          </button>
        </footer>

        {applying && (
          <div className="editor-busy">
            <Spinner text={L("Aplicando ajustes e comprimindo…", "Applying adjustments and compressing…")} />
          </div>
        )}
      </div>
    </div>
  );
}

export function Spinner({ text }: { text?: string }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" />
      {text && <span>{text}</span>}
    </div>
  );
}

/** Como a foto vai aparecer no card e no catálogo (quadro 3:4): preencher ou inteira com blur no fundo. */
function FitSection({
  fit,
  preview,
  busy,
  onFit,
}: {
  fit: Fit;
  preview: string | null;
  busy: boolean;
  onFit: (f: Fit) => void;
}) {
  return (
    <section>
      <h3>{L("No card e no catálogo", "On the card and in the catalog")}</h3>
      <div className="segmented">
        <button className={fit === "cover" ? "on" : ""} onClick={() => onFit("cover")}>
          {L("Preencher", "Fill")}
          <small>{L("ocupa o quadro todo", "covers the whole frame")}</small>
        </button>
        <button className={fit === "blur" ? "on" : ""} onClick={() => onFit("blur")}>
          Blur
          <small>{L("foto inteira, fundo desfocado", "whole photo, blurred background")}</small>
        </button>
      </div>
      <div className="fit-preview">
        {preview ? <FramedImage src={preview} fit={fit} /> : <Spinner />}
        {busy && preview && <span className="busy-dot" />}
      </div>
      <p className="muted tiny">
        {fit === "cover"
          ? L(
              "Dica: recortar em 3:4 deixa a foto exatamente no formato do card.",
              "Tip: cropping to 3:4 makes the photo match the card exactly.",
            )
          : L(
              "A foto aparece inteira; as sobras viram um blur dela mesma.",
              "The whole photo is shown; the leftover space becomes a blur of itself.",
            )}
      </p>
    </section>
  );
}
