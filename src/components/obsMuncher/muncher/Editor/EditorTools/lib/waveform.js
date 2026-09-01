// Fonctions partagées de rendu de waveform.
// Extraites de ClipWaveform pour être réutilisées par AudioViewerTrack
// (vue simplifiée n'affichant qu'une seule waveform) sans dupliquer le code.

// Limite de largeur de bitmap canvas (Chrome plafonne ~16384).
export const MAX_CANVAS_W = 16000;

// Calcule les peaks (max de la valeur absolue) d'un canal audio sur `nBins`
// intervalles. Retourne un Float32Array de longueur `nBins`.
// Indépendant du zoom : le canvas est ensuite simplement étiré en CSS.
export function computePeaks(channelData, nBins) {
  const out = new Float32Array(nBins);
  if (!channelData || nBins <= 0) return out;
  const binSize = channelData.length / nBins;
  for (let i = 0; i < nBins; i++) {
    const a = Math.floor(i * binSize);
    const b = Math.floor((i + 1) * binSize);
    let max = 0;
    for (let j = a; j < b && j < channelData.length; j++) {
      const v = Math.abs(channelData[j]);
      if (v > max) max = v;
    }
    out[i] = max;
  }
  return out;
}

// Dessine les `peaks` en barres centrées verticalement sur `canvas`.
// Le bitmap a une résolution FIXE (1 px logique par bin, plafonné à
// MAX_CANVAS_W) : changer le zoom ne redessine rien, c'est l'étirement CSS
// (style.width) qui s'en charge. `draw` ne tourne donc qu'au changement de
// peaks / couleur / hauteur.
export function drawWaveform(
  canvas,
  peaks,
  { color = "rgb(34, 173, 197)", height } = {},
) {
  if (!canvas || !peaks) return;
  const h = height ?? canvas.parentElement?.clientHeight ?? 0;
  if (h <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.min(peaks.length, MAX_CANVAS_W);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  const mid = h / 2;
  const barW = w / peaks.length;
  for (let i = 0; i < peaks.length; i++) {
    const barH = peaks[i] * mid;
    ctx.fillRect(i * barW, mid - barH, Math.max(barW - 0.5, 0.5), barH * 2);
  }
}
