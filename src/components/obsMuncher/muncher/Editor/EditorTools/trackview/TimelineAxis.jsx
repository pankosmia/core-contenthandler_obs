import { memo } from "react";
import Box from "@mui/material/Box";
import { pickTickInterval } from "../lib/snap";

// Axe de graduations en fond de la lane d'une piste.
// Les ticks s'étendent sur toute la hauteur de la lane et passent derrière les clips
// (positionnement absolu, z-index 0). Les labels restent en haut.
function TimelineAxis({ projectDuration, pxPerSec, isTopAxis = false }) {
  if (projectDuration <= 0 || pxPerSec <= 0) return null;

  const tickEvery = pickTickInterval(projectDuration, pxPerSec);
  const labelEvery = tickEvery * 5;
  const tickPx = tickEvery * pxPerSec;
  const labelPx = labelEvery * pxPerSec;

  // Grille dessinée en CSS (repeating-linear-gradient) plutôt qu'un <Box> par
  // tick : au zoom, le nombre de ticks croît avec contentWidth (jusqu'à des
  // milliers), et recréer autant de nœuds stylés à chaque cran de molette est
  // une grosse source de lag. Deux gradients superposés (lignes majeures #aaa
  // par-dessus mineures #ccc) → zéro nœud DOM, le zoom n'est qu'un repaint.
  const gridImage =
    `repeating-linear-gradient(90deg, #aaa 0, #aaa 1px, transparent 1px, transparent ${labelPx}px),` +
    `repeating-linear-gradient(90deg, #ccc 0, #ccc 1px, transparent 1px, transparent ${tickPx}px)`;

  // Seuls les labels (axe du haut) restent des nœuds DOM, ~5× moins nombreux
  // que les ticks (labelEvery = tickEvery * 5).
  const labels = [];
  if (isTopAxis) {
    for (let t = 0; t <= projectDuration + 1e-6; t += labelEvery) {
      labels.push(t);
    }
  }

  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
        borderLeft: isTopAxis ? "1px solid #777" : "0",
        borderRight: "1px solid #777",
        marginBottom: -0.1,
        marginTop: -0.1,
        marginLeft: !isTopAxis ? 0 : -0.1,
        backgroundImage: gridImage,
      }}
    >
      {labels.map((t) => (
        <Box
          key={t.toFixed(3)}
          sx={{
            position: "absolute",
            left: `${Math.round(t * pxPerSec)}px`,
            top: 0,
            paddingLeft: "2px",
            fontSize: 9,
            color: "#888",
            lineHeight: "12px",
            userSelect: "none",
          }}
        >
          {formatTick(t)}
        </Box>
      ))}
    </Box>
  );
}

export default memo(TimelineAxis);

function formatTick(s) {
  if (s < 1) return `${Math.round(s * 1000)}ms`;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
