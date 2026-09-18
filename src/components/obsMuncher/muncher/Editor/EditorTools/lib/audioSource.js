// Source d'entrée audio d'enregistrement : le micro choisi (par deviceId).
//
// La sélection est persistée en localStorage. Comme l'app est servie sur une
// origine unique (en Electron : http://127.0.0.1:ROCKET_PORT), ce réglage est
// de fait partagé entre tous les munchers et durable, sans backend dédié.

const STORAGE_KEY = "obs.audioInputSource";

export const DEFAULT_SOURCE = { mode: "mic", deviceId: "default" };

export function loadAudioSource() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SOURCE };
    const parsed = JSON.parse(raw);
    if (parsed?.mode !== "mic") return { ...DEFAULT_SOURCE };
    return parsed;
  } catch {
    return { ...DEFAULT_SOURCE };
  }
}

export function saveAudioSource(source) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(source));
  } catch {
    /* quota / mode privé : on ignore, la session courante garde le choix */
  }
}

// Ouvre un MediaStream sur le micro demandé (ou le défaut système).
export async function acquireStream(source = DEFAULT_SOURCE) {
  const deviceId = source?.deviceId;
  const audio =
    deviceId && deviceId !== "default"
      ? { deviceId: { exact: deviceId } }
      : true;
  return navigator.mediaDevices.getUserMedia({ audio });
}
