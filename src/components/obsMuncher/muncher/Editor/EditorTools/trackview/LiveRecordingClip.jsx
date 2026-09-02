import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";

// Clip live affiché PENDANT l'enregistrement, en overlay sur la lane de la
// piste ciblée, à la position du curseur (startTime). Reprend l'apparence d'un
// vrai clip. Sa largeur grandit à 60fps via rAF (style.width direct, sans
// re-render) : largeur = peaks.length / sampleHz * pxPerSec. Le décalage gauche
// suit le curseur : left = startTime * pxPerSec.
const HEADER_HEIGHT = 12;
const INSET_Y = 2;
const COLOR = "rgb(34, 173, 197)";

export default function LiveRecordingClip({
  peaksRef,
  pxPerSec,
  sampleHz,
  startTime = 0,
}) {
  const clipRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  // pxPerSec / startTime changent par paliers ; on les lit via une ref pour ne
  // pas relancer le rAF à chaque update.
  const pxPerSecRef = useRef(pxPerSec);
  pxPerSecRef.current = pxPerSec;
  const startTimeRef = useRef(startTime);
  startTimeRef.current = startTime;

  useEffect(() => {
    const canvas = canvasRef.current;
    const clip = clipRef.current;
    if (!canvas || !clip) return;

    // Largeur pilotée par l'horloge (temps réel écoulé), PAS par le nombre de
    // peaks : le clip s'affiche donc immédiatement à la bonne durée, sans
    // attendre que les peaks s'accumulent. La waveform (canvas) se remplit
    // ensuite au fil des peaks.
    const startedAt = performance.now();

    const draw = () => {
      const peaks = peaksRef.current;
      const pps = pxPerSecRef.current;
      const elapsedSec = (performance.now() - startedAt) / 1000;
      // Position horizontale = curseur. Largeur = durée enregistrée.
      clip.style.left = `${startTimeRef.current * pps}px`;
      const clipW = Math.max(4, elapsedSec * pps);
      clip.style.width = `${clipW}px`;

      const parent = canvas.parentElement;
      if (parent) {
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        if (
          canvas.width !== Math.floor(w * dpr) ||
          canvas.height !== Math.floor(h * dpr)
        ) {
          canvas.width = Math.floor(w * dpr);
          canvas.height = Math.floor(h * dpr);
          canvas.style.width = `${w}px`;
          canvas.style.height = `${h}px`;
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        if (peaks.length && pps > 0) {
          ctx.fillStyle = COLOR;
          const secondsPerPeak = 1 / sampleHz;
          const barW = secondsPerPeak * pps;
          const mid = h / 2;
          for (let i = 0; i < peaks.length; i++) {
            const barH = peaks[i] * mid;
            ctx.fillRect(
              i * barW,
              mid - barH,
              Math.max(barW - 0.5, 0.5),
              barH * 2,
            );
          }
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [peaksRef, sampleHz]);

  return (
    <Box
      ref={clipRef}
      sx={{
        position: "absolute",
        left: 0,
        top: INSET_Y,
        bottom: INSET_Y,
        width: "4px",
        zIndex: 2,
        border: "1px solid rgb(21, 119, 137)",
        borderRadius: "5px",
        background: "rgba(34, 173, 197, 0.22)",
        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.18)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        pointerEvents: "none",
      }}
    >
      <Box
        sx={{
          height: HEADER_HEIGHT,
          background:
            "linear-gradient(180deg, rgba(21,119,137,0.85), rgba(21,119,137,0.55))",
          borderBottom: "1px solid rgba(0, 0, 0, 0.15)",
          flexShrink: 0,
        }}
      />
      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{ display: "block", position: "absolute", top: 0, left: 0 }}
        />
      </Box>
    </Box>
  );
}
