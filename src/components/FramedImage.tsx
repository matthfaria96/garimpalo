import { Fit } from "../api";

/**
 * Foto dentro de um quadro, sem faixas brancas/pretas:
 * - "cover": preenche o quadro inteiro (corta o que sobra);
 * - "blur": a foto aparece inteira e o espaço que sobraria vira um blur dela mesma.
 * O quadro ocupa todo o elemento pai (que precisa ser `position: relative`).
 */
export default function FramedImage({
  src,
  fit,
  lazy,
  className = "",
}: {
  src: string;
  fit: Fit;
  lazy?: boolean;
  className?: string;
}) {
  const loading = lazy ? "lazy" : undefined;
  return (
    <div className={`framed fit-${fit} ${className}`}>
      {fit === "blur" && <img className="framed-bg" src={src} alt="" aria-hidden draggable={false} loading={loading} />}
      <img className="framed-fg" src={src} alt="" draggable={false} loading={loading} />
    </div>
  );
}
