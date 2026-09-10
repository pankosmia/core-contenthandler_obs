// Persistance de l'historique undo/redo "en cache" (localStorage), scopée par
// chapitre. Survit au refresh et à la fermeture de l'onglet, côté navigateur.
//
// On NE stocke jamais les AudioBuffer (non sérialisables) : on strippe comme
// saveProject le fait pour les pistes, et on ré-attache au reload via
// bufferTrackId / track.id (cf. rehydrateTracks dans edl.js).

const HISTORY_VERSION = 1; // bumper pour invalider un cache d'ancien schéma
const HISTORY_CAP = 50; // borne le nombre d'entrées undo/redo gardées en cache

const historyKey = (paths) =>
  `audio-history:v${HISTORY_VERSION}:${paths.localPath}:${paths.project}`;

// Strippe les AudioBuffer d'un tableau de pistes → JSON-sérialisable.
// Même forme que ce que saveProject écrit dans _project.json.
function stripTracks(tracks) {
  return tracks.map(({ buffer, edl, ...rest }) => ({
    ...rest,
    edl: edl.map(({ buffer: _b, ...seg }) => seg),
  }));
}

export function saveHistory(paths, { past, present, future }) {
  if (!paths) return;
  try {
    const payload = {
      version: HISTORY_VERSION,
      savedAt: Date.now(),
      past: past.slice(-HISTORY_CAP).map(stripTracks),
      present: stripTracks(present),
      future: future.slice(0, HISTORY_CAP).map(stripTracks),
    };
    localStorage.setItem(historyKey(paths), JSON.stringify(payload));
  } catch {
    // Quota dépassé / navigation privée : best-effort, on ignore.
    // L'historique runtime continue de marcher, seul le cache disque saute.
  }
}

export function loadHistory(paths) {
  if (!paths) return null;
  try {
    const raw = localStorage.getItem(historyKey(paths));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.version !== HISTORY_VERSION) return null; // schéma périmé
    return data; // { past: [][], present: [], future: [][], savedAt }
  } catch {
    return null;
  }
}

export function clearHistory(paths) {
  if (!paths) return;
  try {
    localStorage.removeItem(historyKey(paths));
  } catch (error) {
    console.error("clearHistory: error removing history", error);
  }
}

// Collecte tous les ids de buffers référencés dans une liste de snapshots :
//   - track.id          → buffer propre de la piste
//   - seg.bufferTrackId → buffer d'une autre piste (clip copié/déplacé)
// Sert à savoir quels .webm charger pour ré-hydrater l'historique, y compris
// les pistes qui n'existent plus que dans le passé (undo d'une suppression).
export function collectBufferIds(snapshots) {
  const ids = new Set();
  for (const tracks of snapshots) {
    for (const t of tracks) {
      // N'ajoute l'id de la piste que si elle a un buffer NATIF : un segment sans
      // bufferTrackId, qui lit le .webm propre de la piste. Une piste vide, ou
      // composée uniquement de clips d'autres pistes, n'a pas de .webm propre →
      // tenter de le charger déclenche un 400 inutile.
      if (t.edl.some((seg) => !seg.bufferTrackId)) ids.add(t.id);
      for (const seg of t.edl) {
        if (seg.bufferTrackId) ids.add(seg.bufferTrackId);
      }
    }
  }
  return ids;
}
