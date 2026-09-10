// Récupère le chemin du binaire ffmpeg téléchargé localement, exposé par le
// backend (GET /api/audio/ffmpeg-path). Le résultat est destiné à être passé
// aux endpoints de compilation audio/vidéo via le champ `ffmpeg_path`.
//
// Renvoie `undefined` si aucun ffmpeg téléchargé n'est trouvé (le backend
// utilisera alors le ffmpeg système), ou en cas d'erreur réseau.
async function getFfmpegPath() {
  try {
    const res = await fetch(`/api/audio/ffmpeg-path`);
    if (!res.ok) return undefined;
    const data = await res.json();
    return data?.payload?.path || undefined;
  } catch {
    return undefined;
  }
}

export default getFfmpegPath;
