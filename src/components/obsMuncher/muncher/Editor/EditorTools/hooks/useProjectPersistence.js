import { useEffect, useRef, useState } from "react";
import { makeTrack, rehydrateTracks, makeEmptyTrack } from "../lib/edl";
import {
  loadProject,
  saveProject,
  loadAudioBuffer,
  saveAudioBlob,
} from "../lib/storageUtil";
import {
  loadHistory,
  saveHistory,
  collectBufferIds,
} from "../lib/historyStorage";

// Forme sérialisable du projet : on retire les AudioBuffer (runtime), le
// bufferTrackId suffit à ré-attacher l'audio au reload.
function projectState(tracks) {
  return {
    tracks: tracks.map(({ buffer, edl, ...rest }) => ({
      ...rest,
      edl: edl.map(({ buffer: _b, ...segRest }) => segRest),
    })),
  };
}
const serializeProject = (tracks) => JSON.stringify(projectState(tracks));

// Synchronise `tracks` avec le backend :
//   - au mount : charge `_project.json`, re-décode chaque .webm en AudioBuffer.
//   - si aucun projet sauvegardé au tout premier mount et `audioUrl` fourni : l'importe comme première piste.
//   - à chaque modif de tracks : sauve le JSON (debounced 500 ms, sans les buffers).

export function useProjectPersistence({
  paths,
  audioCtxRef,
  audioUrl,
  tracks,
  setTracks,
  past,
  setPast,
  future,
  setFuture,
  // Nom de la piste principale d'un projet vierge : le muncher le dérive de la
  // référence courante (ex. "MRK 1:3" en traduction, "1:3" en OBS). Fallback
  // historique "Main track" si non fourni.
  mainTrackName = "Main track",
}) {
  const [projectLoaded, setProjectLoaded] = useState(false);
  // Le fallback audioUrl ne doit s'appliquer qu'au tout premier mount, pas à chaque
  // navigation OBS — sinon naviguer sur un OBS vide ré-importerait la démo.
  const initialLoadRef = useRef(true);
  // Sérialisation du dernier projet écrit sur disque (ou chargé). Sert à n'écrire
  // que sur un vrai changement : un simple chargement ne doit pas réécrire le
  // fichier (sinon son mtime est bumpé et la section paraît "à recompiler").
  const lastSavedRef = useRef(null);

  useEffect(() => {
    if (!paths) return;
    let cancelled = false;
    const isInitial = initialLoadRef.current;
    initialLoadRef.current = false;
    // Reset immédiat : on affiche l'état vide pendant le chargement et si rien n'est trouvé.
    setProjectLoaded(false);
    setTracks([]);
    setPast([]);
    setFuture([]);
    lastSavedRef.current = null;
    (async () => {
      audioCtxRef.current ??= new AudioContext();
      let proj;
      try {
        proj = await loadProject(paths);
      } catch {
        // Serveur injoignable / erreur de chargement : on ne sait pas s'il existe
        // un projet à préserver. On laisse projectLoaded=false pour bloquer toute
        // sauvegarde, afin de ne pas écraser un projet existant par un état vide.
        return;
      }
      if (cancelled) return;

      if (proj?.tracks?.length) {
        const loaded = await Promise.all(
          proj.tracks.map(async (t) => ({
            ...t,
            // Charge le .webm propre de la piste seulement si elle a un segment
            // natif (sans bufferTrackId). Piste vide ou faite uniquement de clips
            // d'autres pistes : pas de .webm propre → on évite un 400 inutile.
            buffer: t.edl?.some((seg) => !seg.bufferTrackId)
              ? await loadAudioBuffer(audioCtxRef.current, paths, t.id)
              : null,
          })),
        );
        const buffersById = new Map(
          loaded.filter((t) => t.buffer).map((t) => [t.id, t.buffer]),
        );
        // Buffers référencés par des clips (bufferTrackId) dont la piste n'est plus
        // dans le projet (supprimée) : le .webm reste sur disque, on le re-décode.
        const referenced = [...collectBufferIds([loaded])].filter(
          (id) => !buffersById.has(id),
        );
        await Promise.all(
          referenced.map(async (id) => {
            const buf = await loadAudioBuffer(audioCtxRef.current, paths, id);
            if (buf) buffersById.set(id, buf);
          }),
        );
        if (cancelled) return;

        // Une piste est valide si chaque segment retrouve SON audio : le buffer
        // de sa piste source pour un clip déplacé/copié (bufferTrackId), le
        // buffer propre de la piste sinon. Une piste sans .webm à elle mais
        // composée de clips d'autres pistes est donc légitime ; une piste dont
        // un fichier manque est droppée (comportement historique).
        const isPlayable = (t) =>
          t.edl.every((seg) => (seg.bufferTrackId ? seg.buffer : t.buffer));
        const resolved = rehydrateTracks(loaded, buffersById).filter(
          isPlayable,
        );

        // --- NEW : historique undo/redo depuis le cache ---
        const hist = loadHistory(paths);
        if (hist) {
          // Buffers référencés par l'historique mais pas déjà chargés pour le projet
          // (typiquement des pistes supprimées qu'un undo peut ramener).
          const snapshots = [...hist.past, hist.present, ...hist.future];
          const missing = [...collectBufferIds(snapshots)].filter(
            (id) => !buffersById.has(id),
          );
          await Promise.all(
            missing.map(async (id) => {
              const buf = await loadAudioBuffer(audioCtxRef.current, paths, id);
              if (buf) buffersById.set(id, buf);
            }),
          );
          if (cancelled) return;
          // Par snapshot, on droppe les pistes dont un buffer a disparu (même
          // critère `isPlayable` que pour le projet).
          const hydrate = (snap) =>
            rehydrateTracks(snap, buffersById).filter(isPlayable);
          setPast(hist.past.map(hydrate));
          setFuture(hist.future.map(hydrate));
          // `present` du cache = état courant → undo/redo restent alignés.
          // (Le _project.json reste la source durable ; ici on préfère le cache
          //  pour que la pile undo soit cohérente avec l'état affiché.)
          const present = hydrate(hist.present);
          setTracks(present);
          lastSavedRef.current = serializeProject(present);
          setProjectLoaded(true);
          return;
        }

        // Pas de cache d'historique : comportement actuel.
        if (!cancelled) {
          setTracks(resolved);
          lastSavedRef.current = serializeProject(resolved);
          setProjectLoaded(true);
        }
        return;
      }

      if (!isInitial || !audioUrl) {
        if (!cancelled) {
          // Projet vierge : vue par défaut = main track + une piste vide.
          const empty = [
            makeEmptyTrack(mainTrackName),
            makeEmptyTrack("Track - 2"),
          ];
          setTracks(empty);
          // Projet vide non enregistré : on traite ce contenu comme déjà "à jour"
          // pour ne pas créer un _project.json sur simple visite.
          lastSavedRef.current = serializeProject(empty);
          setProjectLoaded(true);
        }
        return;
      }
      try {
        const res = await fetch(audioUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const buffer = await audioCtxRef.current.decodeAudioData(
          await blob.arrayBuffer(),
        );
        if (cancelled) return;
        const track = makeTrack(buffer, mainTrackName);
        await saveAudioBlob(paths, track.id, blob);
        if (!cancelled) {
          // Import initial : on laisse lastSavedRef=null pour que la sauvegarde
          // débouncée écrive bien le nouveau _project.json.
          setTracks([track, makeEmptyTrack("Track - 2")]);
          setProjectLoaded(true);
        }
      } catch {
        if (!cancelled) {
          const empty = [
            makeEmptyTrack(mainTrackName),
            makeEmptyTrack("Track - 2"),
          ];
          setTracks(empty);
          lastSavedRef.current = serializeProject(empty);
          setProjectLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paths, audioUrl]);

  // Sauve le projet (_project.json) côté backend, debounced 500 ms, sans les
  // buffers (strip AudioBuffer ; bufferTrackId suffit à ré-attacher au reload).
  // C'est la source durable : sans elle, rien n'est rechargé après navigation.
  useEffect(() => {
    if (!paths || !projectLoaded || tracks.length === 0) return;
    const state = projectState(tracks);
    const serialized = JSON.stringify(state);
    // Contenu identique à ce qui est déjà sur disque (typiquement juste après un
    // chargement) : on n'écrit pas, pour ne pas bumper le mtime du _project.json.
    if (serialized === lastSavedRef.current) return;
    const handle = setTimeout(() => {
      saveProject(paths, state);
      lastSavedRef.current = serialized;
    }, 500);
    return () => clearTimeout(handle);
  }, [tracks, paths, projectLoaded]);

  // Sauve l'historique undo/redo en cache (localStorage), debounced 500 ms.
  // projectLoaded=false pendant le (re)chargement empêche d'écraser le cache
  // avec un état transitoire vide.
  useEffect(() => {
    if (!paths || !projectLoaded) return;
    // Rien à mémoriser tant qu'on n'a ni historique ni contenu.
    if (past.length === 0 && future.length === 0 && tracks.length === 0) return;
    const handle = setTimeout(() => {
      saveHistory(paths, { past, present: tracks, future });
    }, 500);
    return () => clearTimeout(handle);
  }, [past, future, tracks, paths, projectLoaded]);

  return { projectLoaded };
}
