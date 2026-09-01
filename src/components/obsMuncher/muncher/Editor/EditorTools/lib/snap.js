// Intervalle entre deux ticks affichés sur la timeline. Sert aussi de pas de
// snap par défaut pour rester aligné sur la grille visible.
const TICK_STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 300];
export function pickTickInterval(duration, pxPerSec = 0) {
  // Quand pxPerSec est connu (timeline montée/zoomée), on choisit le pas qui
  // garde au moins MIN_TICK_PX entre deux ticks → la grille se resserre au zoom.
  if (pxPerSec > 0) {
    const MIN_TICK_PX = 12;
    for (const s of TICK_STEPS) if (s * pxPerSec >= MIN_TICK_PX) return s;
    return TICK_STEPS[TICK_STEPS.length - 1];
  }
  // Fallback historique (par durée) tant que pxPerSec n'est pas connu.
  if (duration < 5) return 0.2;
  if (duration < 20) return 0.5;
  if (duration < 60) return 1;
  if (duration < 300) return 5;
  return 30;
}

// Renvoie la valeur snappée la plus proche de `t` parmi :
//  - les valeurs dans `candidates` (bords de clips, playhead…)
//  - les multiples de `snapStep` (grille temporelle)
// dans un rayon `thresholdSec`. Renvoie `t` inchangé si rien n'est assez proche.
//
// `minTarget`/`maxTarget` permettent un filtre directionnel : pendant un drag
// vers la droite, on borne par `minTarget = position d'origine` pour empêcher
// le snap de tirer en arrière.
export function snapTime(
  t,
  {
    snapStep,
    candidates = [],
    thresholdSec,
    minTarget = -Infinity,
    maxTarget = Infinity,
  },
) {
  let best = t;
  let bestDist = thresholdSec;

  // Comparaisons strictes : si minTarget/maxTarget = position d'origine du
  // bord du clip, on EXCLUT cette position d'origine pour ne pas snapper en
  // arrière à un drag de quelques pixels quand le clip était déjà aligné.
  for (const c of candidates) {
    if (c <= minTarget || c >= maxTarget) continue;
    const d = Math.abs(c - t);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }

  if (snapStep > 0) {
    const gridT = Math.round(t / snapStep) * snapStep;
    if (gridT > minTarget && gridT < maxTarget) {
      const d = Math.abs(gridT - t);
      if (d <= bestDist) {
        best = gridT;
        bestDist = d;
      }
    }
  }

  return best;
}
