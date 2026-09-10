// Audio  : audio_content/[{BOOK}/]{CC}-{PP}/{CC}-{PP}_{trackId}.webm   (blob MediaRecorder brut)
// Projet : audio_content/[{BOOK}/]{CC}-{PP}/{CC}-{PP}_project.json
// `book` is optional: OBS omits it (single book), scripture audio passes the
// book code so {CC}-{PP} doesn't collide across books.

export function projectPaths({ localPath, book, chapter, paragraph }) {
  const cc = String(chapter).padStart(2, "0");
  const pp = String(paragraph).padStart(2, "0");
  const dir = book
    ? `audio_content/${book}/${cc}-${pp}`
    : `audio_content/${cc}-${pp}`;
  return {
    localPath,
    audio: (id) => `${dir}/${cc}-${pp}_${id}.webm`,
    project: `${dir}/${cc}-${pp}_project.json`,
    bytesUrl: (ipath) =>
      `/api/burrito/ingredient/bytes/${localPath}?ipath=${ipath}`,
    deleteUrl: (ipath) =>
      `/api/burrito/ingredient/delete/${localPath}?ipath=${ipath}`,
    // history: `${dir}/${cc}-${pp}_history.json`,
  };
}

// Renvoie le projet, ou null si le fichier n'existe pas (404).
// Lève une erreur si le serveur est injoignable ou répond une autre erreur :
// l'appelant doit alors s'abstenir de sauvegarder pour ne pas écraser un projet existant.
export async function loadProject(paths) {
  const r = await fetch(paths.bytesUrl(paths.project));
  // Le backend burrito répond 400 (et non 404) quand l'ingrédient/ipath
  // n'existe pas encore : pour un chapitre jamais enregistré, c'est un cas
  // normal "pas de projet", pas une erreur serveur. On le traite comme absent
  // pour ne pas bloquer la première sauvegarde (projectLoaded resterait false).
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error(`loadProject: HTTP ${r.status}`);
  return await r.json();
}

export async function saveProject(paths, state) {
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([JSON.stringify(state)], { type: "application/json" }),
  );
  await fetch(paths.bytesUrl(paths.project), { method: "POST", body: fd });
}

export async function saveAudioBlob(paths, id, blob) {
  const fd = new FormData();
  fd.append("file", blob);
  await fetch(paths.bytesUrl(paths.audio(id)), { method: "POST", body: fd });
}

export async function loadAudioBuffer(ctx, paths, id) {
  try {
    const r = await fetch(paths.bytesUrl(paths.audio(id)));
    if (!r.ok) return null;
    return await ctx.decodeAudioData(await r.arrayBuffer());
  } catch {
    return null;
  }
}

export async function deleteAudioFile(paths, id) {
  await fetch(paths.deleteUrl(paths.audio(id)), { method: "DELETE" });
}
