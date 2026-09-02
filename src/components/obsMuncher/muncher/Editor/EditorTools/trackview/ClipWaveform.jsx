import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { segmentBuffer } from "../lib/edl";
import { computePeaks, drawWaveform } from "../lib/waveform";

// Dessine la waveform du BUFFER ENTIER (pas seulement de la portion [srcStart,
// srcEnd]) en absolu dans le wrapper, positionné par `left = -srcStart*pxPerSec`.
// Combiné à `overflow: hidden` sur le Clip parent, la portion visible
// correspond exactement au segment. Pendant un resize, on n'a qu'à déplacer
// le canvas (translateX) et changer la largeur du Clip : aucun recalcul de
// peaks, aucun re-render React → pas de tremblement.

const ClipWaveform = forwardRef(function ClipWaveform(
  { segment, trackBuffer, pxPerSec, color = "rgb(34, 173, 197)" },
  ref,
) {
  const canvasRef = useRef(null);
  const drawRef = useRef(null);

  const segBuf = segmentBuffer(segment, trackBuffer);
  const bufDur = segBuf?.duration ?? 0;
  // Largeur AFFICHÉE du buffer entier (CSS) : suit le zoom. Le bitmap du canvas,
  // lui, garde une résolution FIXE (cf. draw) et est simplement étiré en CSS →
  // changer le zoom ne redessine rien, c'est une pure mise à jour de style.
  const displayWidthPx = bufDur * pxPerSec;
  const canvasLeftPx = -segment.srcStart * pxPerSec;

  // Peaks du buffer ENTIER, indépendants du segment. Recalcul uniquement
  // si le buffer change ou si la largeur cible bouge significativement.
  // On vise N_BINS bins, indépendant du zoom : le canvas est ensuite étiré
  // CSS au besoin si pxPerSec change.
  const N_BINS = 4000;
  const peaks = useMemo(() => {
    if (!segBuf) return null;
    return computePeaks(segBuf.getChannelData(0), N_BINS);
  }, [segBuf]);

  const draw = () => {
    drawWaveform(canvasRef.current, peaks, { color });
  };
  drawRef.current = draw;

  useLayoutEffect(() => {
    draw();
  }, [peaks, color]);

  // Le parent peut changer de hauteur (resize fenêtre, rezoom UI) :
  // ResizeObserver pour re-draw quand ça arrive. Setup une fois.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const ro = new ResizeObserver(() => drawRef.current?.());
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  // API impérative pour translater le canvas pendant un resize en cours,
  // sans déclencher de re-render React. Le parent (Clip) appelle ça à
  // chaque mousemove, et au lâcher React commit le nouveau srcStart, ce
  // qui repositionne le canvas via la prop `left`.
  useImperativeHandle(
    ref,
    () => ({
      setSrcStartPx: (px) => {
        const c = canvasRef.current;
        if (c) c.style.left = `${-px}px`;
      },
    }),
    [],
  );

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block",
        position: "absolute",
        top: 0,
        left: `${canvasLeftPx}px`,
        width: `${displayWidthPx}px`,
        height: "100%",
      }}
    />
  );
});

export default ClipWaveform;
