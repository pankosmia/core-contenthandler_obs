import { useEffect, useLayoutEffect, useRef } from "react";
import Box from "@mui/material/Box";
import { drawWaveform } from "./lib/waveform";

// Lane simplifiée et présentationnelle : dessine une seule waveform (peaks
// fournis par le parent) et un playhead plaçable au clic. Pas de décodage,
// pas de lecture, pas de clips/sélection/drag ni de colonne de nom — tout ça
// est géré (ou retiré) par AudioViewer. Le dessin réutilise drawWaveform de
// lib/waveform (partagé avec TrackView/ClipWaveform).
//
// La waveform remplit 100% de la largeur (le parent dimensionne la timeline à
// la durée réelle de l'audio), donc temps ↔ position se mappe en pourcentage :
// x = (t / duration) * largeur. C'est cohérent avec l'axe (TimelineAxis) du
// parent qui couvre la même largeur.
export default function AudioViewerTrack({
  peaks,
  duration,
  playheadTime = 0,
  color = "rgb(34, 173, 197)",
  height = 96,
  onSeek,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const drawRef = useRef(null);

  const draw = () => {
    drawWaveform(canvasRef.current, peaks, { color, height });
  };
  drawRef.current = draw;

  useLayoutEffect(() => {
    draw();
  }, [peaks, color, height]);

  // Re-dessine si le conteneur change de taille (resize fenêtre, layout).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => drawRef.current?.());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const onPointerDown = (e) => {
    if (e.button !== 0 || !duration) return;
    const rect = wrapRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek?.(Math.max(0, Math.min(duration, ratio * duration)));
  };

  const playheadPct = duration > 0 ? (playheadTime / duration) * 100 : 0;

  return (
    <Box
      ref={wrapRef}
      onPointerDown={onPointerDown}
      sx={{
        position: "relative",
        width: "100%",
        height,
        cursor: "pointer",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
      {duration > 0 && (
        <Box
          sx={{
            position: "absolute",
            left: `${playheadPct}%`,
            top: 0,
            bottom: 0,
            width: "2px",
            bgcolor: "red",
            opacity: 0.7,
            pointerEvents: "none",
            zIndex: 3,
          }}
        />
      )}
    </Box>
  );
}
