import {
  useState,
  useRef,
  useMemo,
  useEffect,
  useCallback,
  useLayoutEffect,
} from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import MicIcon from "@mui/icons-material/MicNoneOutlined";
import StopIcon from "@mui/icons-material/StopOutlined";
import PlayArrowIcon from "@mui/icons-material/PlayArrowOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import ContentPasteIcon from "@mui/icons-material/ContentPasteOutlined";
import ContentCutIcon from "@mui/icons-material/ContentCutOutlined";
import UndoIcon from "@mui/icons-material/UndoOutlined";
import RedoIcon from "@mui/icons-material/RedoOutlined";
import AddIcon from "@mui/icons-material/AddOutlined";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import ZoomInIcon from "@mui/icons-material/ZoomInOutlined";
import ZoomOutIcon from "@mui/icons-material/ZoomOutOutlined";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";

import TrackView from "./TrackView";
import { scheduleTrackFrom, stopSources } from "./lib/playback";
import TimelineAxis from "./trackview/TimelineAxis";
import { projectPaths } from "./lib/storageUtil";
import { useProjectPersistence } from "./hooks/useProjectPersistence";
import { useRecorder } from "./hooks/useRecorder";
import { formatTime } from "./Timeline";
import {
  cutRange,
  extractRange,
  overwriteAt,
  splitAt,
  trimSegment,
  removeSegment,
  insertSegmentAt,
  virtualDuration,
  segmentBuffer,
  makeSegment,
  makeEmptyTrack,
} from "./lib/edl";
import { pickTickInterval } from "./lib/snap";
import { NAME_COL_W, NAME_COL_INNER_W } from "./lib/timelineLayout";
import SplitIcon from "./SplitIcon";
import CursorToStartIcon from "./CursorToStartIcon";
import MicSourcePicker from "./MicSourcePicker";
import { loadAudioSource, saveAudioSource } from "./lib/audioSource";
// import GestureIcon from "./GestureIcon";

const MIN_TIMELINE_SEC = 15;

// Espace vide toujours réservé après le dernier clip, pour pouvoir démarrer une
// sélection (highlight) au bout de la piste — même au zoom minimum, où toute la
// timeline tient dans le viewport. Exprimé en fraction de la durée du contenu
// (≈ largeur constante à l'écran au fit) avec un plancher en secondes pour les
// pistes très courtes.
const RIGHT_TAIL_FRACTION = 0.08;
const RIGHT_TAIL_MIN_SEC = 2;

const ZOOM_MIN = 1;
const ZOOM_MAX = 40;
const ZOOM_WHEEL_FACTOR = 1.0015;

export default function AudioRecorder({
  audioUrl,
  obs,
  metadata,
  book,
  mainTrackName,
}) {
  const audioCtxRef = useRef(null);
  const [tracks, setTracks] = useState([]);
  // Source d'entrée audio (micro choisi), persistée en localStorage et partagée
  // avec l'enregistreur. Le sélecteur (MicSourcePicker) la met à jour.
  const [audioSource, setAudioSource] = useState(loadAudioSource);
  const changeAudioSource = useCallback((next) => {
    setAudioSource(next);
    saveAudioSource(next);
  }, []);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerHeadTime, setPlayerHeadTime] = useState(0);
  // Cible de l'enregistrement en cours : { trackId, startTime } figé au record()
  // pour afficher le clip live au bon endroit (bonne piste + position curseur).
  const [recordTarget, setRecordTarget] = useState(null);
  // Region/selection
  const [selection, setSelection] = useState(null); // { trackId, time }
  const [regionSelection, setRegionSelection] = useState(null); // { trackId, start, end }
  // Sélection de clip(s) : tableau d'entrées {trackId, segId}. Permet multi-sélection
  // cross-tracks via Ctrl/Cmd. Le ref `clipSelectionAnchor` retient le pivot pour
  // l'extension Shift-clic (range sur la même piste).
  const [clipSelection, setClipSelection] = useState([]);
  const clipSelectionAnchorRef = useRef(null);
  const [clipboard, setClipboard] = useState(null); // { buffer, segments }
  // undo/redo
  const [future, setFuture] = useState([]); // historique des actions apres le undo
  const [past, setPast] = useState([]); // historique des actions

  const playStartedAtRef = useRef(0);
  const playEndsAtRef = useRef(0);
  const playingFromRef = useRef(null); // { trackId, startTime } figé au play()
  const rafRef = useRef(null);
  const sourcesRef = useRef([]);
  const tracksRef = useRef([]);
  tracksRef.current = tracks;

  // Snap
  const [snapEnabled, setSnapEnabled] = useState(
    () => localStorage.getItem("snapEnabled") !== "false",
  );

  // excludeSegIds : Set<string> | string | null — rétro-compatible.
  const getSnapCandidates = (trackId, excludeSegIds) => {
    const exclude =
      excludeSegIds instanceof Set
        ? excludeSegIds
        : new Set(excludeSegIds ? [excludeSegIds] : []);
    const t = tracks.find((x) => x.id === trackId);
    if (!t) return [];
    const out = [];
    for (const s of t.edl) {
      if (exclude.has(s.id)) continue;
      out.push(s.vStart);
      out.push(s.vStart + (s.srcEnd - s.srcStart));
    }
    if (selection?.trackId === trackId && selection.time != null) {
      out.push(selection.time);
    }
    return out;
  };

  const paths = useMemo(
    () =>
      metadata?.local_path && obs
        ? projectPaths({
            localPath: metadata.local_path,
            book,
            chapter: obs[0],
            paragraph: obs[1],
          })
        : null,
    [metadata?.local_path, obs, book],
  );

  const { projectLoaded } = useProjectPersistence({
    paths,
    audioCtxRef,
    audioUrl,
    tracks,
    setTracks,
    past,
    setPast,
    future,
    setFuture,
    mainTrackName,
  });

  // Signale au parent toute édition audio, pour activer le bouton sauvegarder en
  // quasi temps réel (optimiste : une édition rend forcément l'mp3 périmé).
  // On ignore le chargement du projet : seuls les changements de `tracks` APRÈS
  // le load comptent comme édition.
  const audioLoadedRef = useRef(false);
  useEffect(() => {
    // Nouvelle section : on repart de "chargé, pas encore édité".
    audioLoadedRef.current = false;
  }, [paths?.project]);
  useEffect(() => {
    if (!projectLoaded) return;
    if (!audioLoadedRef.current) {
      // Premier état après load = projet chargé, pas une édition.
      audioLoadedRef.current = true;
      return;
    }
  }, [tracks, projectLoaded]);

  // Snapshot l'état courant des pistes dans l'historique undo. Stable et basée
  // sur tracksRef car l'enregistreur commite de façon asynchrone (onstop),
  // hors des handlers synchrones où `setTracksWithHistory` lit le `tracks` du
  // render courant. Sans ça, une prise n'était pas annulable (Ctrl+Z).
  const pushHistory = useCallback(() => {
    setPast((p) => [...p, tracksRef.current].slice(-HISTORY_CAP));
    setFuture([]);
  }, []);

  const {
    isRecording,
    startRecording,
    stopRecording,
    recordingDuration,
    peaksRef,
    sampleHz,
  } = useRecorder({
    paths,
    audioCtxRef,
    setTracks,
    tracksRef,
    pushHistory,
    source: audioSource,
  });

  const projectDuration = useMemo(() => {
    const trackMax = tracks.reduce(
      (max, t) => Math.max(max, virtualDuration(t)),
      0,
    );
    if (recordingDuration <= 0) {
      // Hors enregistrement : on ajoute une queue vide après le dernier clip
      // pour garder de l'espace cliquable au bout (cf. RIGHT_TAIL_*).
      const trackMaxWithTail =
        trackMax > 0
          ? trackMax +
            Math.max(RIGHT_TAIL_MIN_SEC, trackMax * RIGHT_TAIL_FRACTION)
          : trackMax;
      return Math.max(MIN_TIMELINE_SEC, trackMaxWithTail);
    }
    // Pendant l'enregistrement, élargit la timeline par paliers de 5s
    // avec ~5s de marge à droite. Donne de la place au clip live pour
    // grandir visuellement, et évite que pxPerSec change à chaque tick
    // d'update de recordingDuration (saut tous les 5s seulement).
    // On part du curseur (recordTarget.startTime) car la prise y est posée.
    const liveEnd = (recordTarget?.startTime ?? 0) + recordingDuration;
    const liveWindow = Math.max(10, Math.ceil(liveEnd / 5) * 5 + 5);
    return Math.max(MIN_TIMELINE_SEC, trackMax, liveWindow);
  }, [tracks, recordingDuration, recordTarget]);

  const [laneWidth, setLaneWidth] = useState(0);
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const scrollRef = useRef(null);
  const pendingScrollLeftRef = useRef(null);
  // Position X (px de contenu) du curseur — sert d'ancre au zoom boutons/clavier.
  const playheadXRef = useRef(0);

  // laneWidth = largeur du conteneur scrollé (inclut la gouttière nom).
  const viewportWidth = Math.max(0, laneWidth - NAME_COL_W);
  const fitPxPerSec = projectDuration > 0 ? viewportWidth / projectDuration : 0;
  const pxPerSec = fitPxPerSec * zoom;
  const contentWidth = projectDuration * pxPerSec;

  // snapStep = même intervalle que les ticks affichés par TimelineAxis.
  // Quand on zoome, pxPerSec augmente → le pas de grille (et le snap) se resserre.
  const snapStep = pickTickInterval(projectDuration, pxPerSec);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setLaneWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setLaneWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Zoom ancré sur le curseur (playhead), pas sur le centre du viewport.
  const zoomBy = useCallback((factor) => {
    const el = scrollRef.current;
    setZoom((z) => {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor));
      if (next !== z && el) {
        // Garde le point sous le curseur à la même position à l'écran.
        const anchorContentX = playheadXRef.current; // px de contenu (zoom z)
        const anchorViewportX = anchorContentX - el.scrollLeft;
        pendingScrollLeftRef.current =
          anchorContentX * (next / z) - anchorViewportX;
      }
      return next;
    });
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(ZOOM_MIN);
    pendingScrollLeftRef.current = 0;
  }, []);

  // Ctrl + molette → zoom autour du curseur. Shift + molette → pan horizontal.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Les events molette arrivent bien plus vite que 60 Hz (surtout trackpad).
    // Sans throttle, chacun déclenche un setZoom → re-render de tout l'arbre +
    // une écriture de scrollLeft (reflow) : c'est la source principale du lag.
    // On accumule les deltas et on n'applique qu'un seul zoom par frame.
    let accumDelta = 0;
    let anchor = null; // { cursorX, contentX } du dernier event de la frame
    let rafId = null;

    const applyZoom = () => {
      rafId = null;
      const dy = accumDelta;
      accumDelta = 0;
      if (!anchor || dy === 0) return;
      const { cursorX, contentX } = anchor;
      setZoom((z) => {
        const next = Math.min(
          ZOOM_MAX,
          Math.max(ZOOM_MIN, z * Math.pow(ZOOM_WHEEL_FACTOR, -dy)),
        );
        if (next !== z) {
          // contentWidth ∝ zoom : le point sous le curseur passe de contentX à
          // contentX * (next/z). On recale scrollLeft pour le garder sous la souris.
          pendingScrollLeftRef.current = contentX * (next / z) - cursorX;
        }
        return next;
      });
    };

    const onWheel = (e) => {
      // Shift + molette : pan horizontal (sans zoom).
      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
        return;
      }
      if (!e.ctrlKey && !e.metaKey) return; // molette seule = scroll vertical normal
      e.preventDefault(); // bloque le zoom navigateur

      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left; // px dans le viewport scrollé
      accumDelta += e.deltaY;
      // scrollLeft/zoom n'ont pas changé depuis le dernier commit, donc contentX
      // reste cohérent avec le zoom courant pour toute la frame.
      anchor = { cursorX, contentX: el.scrollLeft + cursorX };
      if (rafId == null) rafId = requestAnimationFrame(applyZoom);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Applique la cible de scroll APRÈS le re-render (quand scrollWidth a la
  // nouvelle largeur), sinon le navigateur clampe scrollLeft à l'ancienne largeur.
  useLayoutEffect(() => {
    if (pendingScrollLeftRef.current != null && scrollRef.current) {
      scrollRef.current.scrollLeft = pendingScrollLeftRef.current;
      pendingScrollLeftRef.current = null;
    }
  }, [zoom]);

  // Pendant la lecture zoomée, garder le playhead visible (auto-page).
  useEffect(() => {
    if (!isPlaying || zoom <= ZOOM_MIN) return;
    const el = scrollRef.current;
    if (!el || pxPerSec <= 0) return;
    const t = (playingFromRef.current?.startTime ?? 0) + playerHeadTime;
    const x = t * pxPerSec;
    const view = el.clientWidth - NAME_COL_W; // zone visible des lanes
    if (x < el.scrollLeft || x > el.scrollLeft + view) {
      el.scrollLeft = Math.max(0, x - view * 0.1);
    }
  }, [playerHeadTime, isPlaying, zoom, pxPerSec]);

  useEffect(() => {
    if (tracks.length === 0 || selection) return;
    setSelection({ trackId: tracks[0].id, time: 0 });
  }, [tracks, selection]);

  // Pour afficher le temps meme quand on ne joue pas de track
  const displayTime = isPlaying
    ? (playingFromRef.current?.startTime ?? 0) + playerHeadTime
    : (selection?.time ?? 0);

  // Ancre du zoom (boutons/clavier) : position du curseur en px de contenu.
  playheadXRef.current = displayTime * pxPerSec;

  const tick = () => {
    const elapsed = Math.max(
      0,
      audioCtxRef.current.currentTime - playStartedAtRef.current,
    );
    if (elapsed >= playEndsAtRef.current) {
      // Met le curseur à la fin de la piste
      const trackId = playingFromRef.current?.trackId;
      const startTime = playingFromRef.current?.startTime ?? 0;
      if (trackId != null) {
        setSelection({ trackId, time: startTime + playEndsAtRef.current });
      }
      playingFromRef.current = null;
      setPlayerHeadTime(0);
      setIsPlaying(false);
      rafRef.current = null;
      return;
    }
    setPlayerHeadTime(elapsed);
    rafRef.current = requestAnimationFrame(tick);
  };

  // Démarre/redémarre la lecture sur (trackId, time).
  // Suppose que l'AudioContext est déjà actif.
  const startPlayback = (trackId, time) => {
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    stopSources(sourcesRef.current);
    sourcesRef.current = scheduleTrackFrom(audioCtxRef.current, track, time);
    playStartedAtRef.current = audioCtxRef.current.currentTime + 0.05;
    playEndsAtRef.current = virtualDuration(track) - time;
    playingFromRef.current = { trackId, startTime: time };
    setPlayerHeadTime(0);
    setIsPlaying(true);
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  const play = async () => {
    if (isPlaying || tracks.length === 0) return;
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }
    const trackId = selection?.trackId ?? tracks[0].id;
    const time = selection?.time ?? 0;
    startPlayback(trackId, time);
  };

  // Comme la lecture : on enregistre sur la piste où est le curseur, à sa
  // position temporelle (overwrite si la piste a déjà du contenu).
  const record = () => {
    const trackId = selection?.trackId ?? tracks[0]?.id ?? null;
    const time = selection?.time ?? 0;
    setRecordTarget(trackId != null ? { trackId, startTime: time } : null);
    startRecording(trackId, time);
  };

  // L'enregistrement terminé (ou annulé) : on retire le clip live.
  useEffect(() => {
    if (!isRecording) setRecordTarget(null);
  }, [isRecording]);

  // Ajoute une piste vide en bas, prête à recevoir un enregistrement, et y
  // place le curseur pour qu'un Record immédiat l'utilise.
  const addTrack = () => {
    const id = crypto.randomUUID();
    setTracksWithHistory((ts) => [
      ...ts,
      makeEmptyTrack(`Track - ${ts.length + 1}`, id),
    ]);
    setSelection({ trackId: id, time: 0 });
  };

  const stop = () => {
    // capture la pos du cursuer avant de reset
    const trackId = playingFromRef.current?.trackId;
    const startTime = playingFromRef.current?.startTime ?? 0;
    const currentPos = startTime + playerHeadTime;

    stopSources(sourcesRef.current);
    sourcesRef.current = [];
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    playingFromRef.current = null;
    setPlayerHeadTime(0);
    setIsPlaying(false);

    // remet la pos du curseur
    if (trackId != null) {
      setSelection({ trackId, time: currentPos });
    }
  };

  // Clic sur une waveform ->> on retient piste + position, et on relance la lecture depuis ce point si on est en train de jouer.
  const handleSeek = (trackId, time) => {
    setSelection({ trackId, time });
    // Un seek (clic playhead) efface la sélection de clip : seul un clic
    // sur le header d'un clip doit la maintenir/étendre.
    setClipSelection([]);
    clipSelectionAnchorRef.current = null;
    if (isPlaying) startPlayback(trackId, time);
  };

  // Ramène le curseur au tout début de la piste courante (temps 0).
  const cursorToStart = () => {
    const trackId = selection?.trackId ?? tracks[0]?.id;
    if (trackId == null) return;
    handleSeek(trackId, 0);
  };

  // Sélection clip(s) — appelée depuis le header d'un clip.
  // mods : { ctrlKey, shiftKey } pour multi/range.
  const handleClipSelect = (trackId, segId, mods = {}) => {
    const { ctrlKey, shiftKey } = mods;
    // Shift-clic : étend depuis l'anchor sur la même piste (range par vStart).
    if (shiftKey && clipSelectionAnchorRef.current) {
      const anchor = clipSelectionAnchorRef.current;
      if (anchor.trackId === trackId) {
        const track = tracks.find((t) => t.id === trackId);
        if (track) {
          const a = track.edl.find((s) => s.id === anchor.segId);
          const b = track.edl.find((s) => s.id === segId);
          if (a && b) {
            const lo = Math.min(a.vStart, b.vStart);
            const hi = Math.max(a.vStart, b.vStart);
            const next = track.edl
              .filter((s) => s.vStart >= lo && s.vStart <= hi)
              .map((s) => ({ trackId, segId: s.id }));
            setClipSelection(next);
            // anchor inchangé
            setRegionSelection(null);
            return;
          }
        }
      }
      // anchor sur une autre piste -> fallback : sélection simple
    }
    // Ctrl/Cmd : toggle ce clip dans la sélection.
    if (ctrlKey) {
      setClipSelection((prev) => {
        const idx = prev.findIndex(
          (c) => c.trackId === trackId && c.segId === segId,
        );
        if (idx >= 0) {
          const next = prev.slice();
          next.splice(idx, 1);
          return next;
        }
        return [...prev, { trackId, segId }];
      });
      clipSelectionAnchorRef.current = { trackId, segId };
      setRegionSelection(null);
      return;
    }
    // Clic simple : remplace la sélection par ce seul clip.
    setClipSelection([{ trackId, segId }]);
    clipSelectionAnchorRef.current = { trackId, segId };
    setRegionSelection(null);
  };

  const clearClipSelection = () => {
    setClipSelection([]);
    clipSelectionAnchorRef.current = null;
  };

  const deleteSelectedClips = () => {
    if (clipSelection.length === 0) return;
    // Groupe les segIds par trackId pour faire un seul update par piste.
    const byTrack = new Map();
    for (const { trackId, segId } of clipSelection) {
      if (!byTrack.has(trackId)) byTrack.set(trackId, new Set());
      byTrack.get(trackId).add(segId);
    }
    setTracksWithHistory((ts) =>
      ts.map((t) => {
        const ids = byTrack.get(t.id);
        if (!ids) return t;
        return { ...t, edl: t.edl.filter((s) => !ids.has(s.id)) };
      }),
    );
    clearClipSelection();
  };

  const deleteRegionWithoutCopy = () => {
    if (!regionSelection) return;
    const { trackId, start, end } = regionSelection;
    setTracksWithHistory((ts) =>
      ts.map((t) =>
        t.id === trackId ? { ...t, edl: cutRange(t.edl, start, end) } : t,
      ),
    );
    setRegionSelection(null);
  };

  const HISTORY_CAP = 150;
  const setTracksWithHistory = (updater) => {
    setPast((p) => [...p, tracks].slice(-HISTORY_CAP));
    setFuture([]);
    setTracks(updater);
  };

  const deleteTrack = (id) => {
    // On retire la piste de l'état mais on NE supprime PAS le fichier .webm :
    // d'autres pistes peuvent référencer ce buffer via bufferTrackId (clip
    // copié/déplacé), et le projet doit rester réimportable.
    setTracksWithHistory((ts) => ts.filter((t) => t.id !== id));
    if (selection?.trackId === id) setSelection(null);
  };

  const cutSelection = () => {
    // Priorité à la sélection de clips : copier puis supprimer les clips choisis.
    if (clipSelection.length > 0) {
      copyClipSelection();
      deleteSelectedClips();
      return;
    }
    if (!regionSelection) return;
    const { trackId, start, end } = regionSelection;
    // setTracks(ts => ts.map(t =>
    //     t.id === trackId ? { ...t, edl: cutRange(t.edl, start, end) } : t
    // ));
    copySelection();
    setTracksWithHistory((ts) =>
      ts.map((t) =>
        t.id === trackId ? { ...t, edl: cutRange(t.edl, start, end) } : t,
      ),
    );

    setRegionSelection(null);
  };

  const copySelection = () => {
    // Priorité à la sélection de clips si présente.
    if (clipSelection.length > 0) {
      copyClipSelection();
      return;
    }
    if (!regionSelection) return;
    const { trackId, start, end } = regionSelection;
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    // Tag chaque segment extrait avec le buffer source + l'id de la piste source.
    // - le buffer permet le paste runtime (réf directe)
    // - l'id permet de ré-attacher le buffer après un reload de projet
    const segs = extractRange(track.edl, start, end, track.buffer, track.id);
    if (!segs.length) return;
    setClipboard({ segments: segs });
  };

  // Copie les clips actuellement sélectionnés vers le presse-papier.
  // Les positions vStart sont normalisées par rapport au clip le plus à gauche
  // pour préserver les écarts relatifs entre clips lors du collage.
  const copyClipSelection = () => {
    if (clipSelection.length === 0) return;
    const segs = [];
    for (const { trackId, segId } of clipSelection) {
      const track = tracks.find((t) => t.id === trackId);
      if (!track) continue;
      const seg = track.edl.find((s) => s.id === segId);
      if (!seg) continue;
      // makeSegment génère de nouveaux ids et tague le buffer/track source
      // (réf runtime + id sérialisable) comme le fait extractRange.
      segs.push(
        makeSegment(
          seg.vStart,
          seg.srcStart,
          seg.srcEnd,
          seg.buffer || track.buffer,
          seg.bufferTrackId || track.id,
        ),
      );
    }
    if (!segs.length) return;
    const minV = Math.min(...segs.map((s) => s.vStart));
    const normalized = segs.map((s) => ({ ...s, vStart: s.vStart - minV }));
    setClipboard({ segments: normalized });
  };

  const pasteAtCursor = () => {
    if (!clipboard || !selection) return;
    const { trackId, time } = selection;
    setTracksWithHistory((ts) =>
      ts.map((t) =>
        t.id === trackId
          ? { ...t, edl: overwriteAt(t.edl, time, clipboard.segments) }
          : t,
      ),
    );
  };

  const renameTrack = (trackId, newName) => {
    setTracks((ts) =>
      ts.map((t) => (t.id === trackId ? { ...t, name: newName } : t)),
    );
  };

  // Récupérer les bords des clips qui se font resize
  const getResizeBounds = (trackId, segId) => {
    const t = tracks.find((x) => x.id === trackId);
    if (!t) return { minVStart: 0, maxVEnd: Infinity };
    const sorted = [...t.edl].sort((a, b) => a.vStart - b.vStart);
    const idx = sorted.findIndex((s) => s.id === segId);
    if (idx < 0) return { minVStart: 0, maxVEnd: Infinity };
    const seg = sorted[idx];
    const prev = sorted[idx - 1];
    const next = sorted[idx + 1];

    // Bornes voisines (anti-collision).
    const neighborMinVStart = prev
      ? prev.vStart + (prev.srcEnd - prev.srcStart)
      : 0;
    const neighborMaxVEnd = next ? next.vStart : Infinity;

    // Bornes audio : le segment ne peut pas montrer plus que le buffer source.
    // À gauche, srcStart ≥ 0 → vStart ne peut reculer que de srcStart secondes.
    // À droite, srcEnd ≤ buffer.duration → vEnd ne peut avancer que du reste.
    const buf = segmentBuffer(seg, t.buffer);
    const vEnd = seg.vStart + (seg.srcEnd - seg.srcStart);
    const audioMinVStart = seg.vStart - seg.srcStart;
    const audioMaxVEnd =
      typeof buf?.duration === "number"
        ? vEnd + (buf.duration - seg.srcEnd)
        : Infinity;

    const minVStart = Math.max(neighborMinVStart, audioMinVStart);
    const maxVEnd = Math.max(
      minVStart,
      Math.min(neighborMaxVEnd, audioMaxVEnd),
    );
    return { minVStart, maxVEnd };
  };

  const getMoveBounds = (trackId, segId, excludeIds = new Set()) => {
    const t = tracks.find((x) => x.id === trackId);
    if (!t) return { minVStart: 0, maxVStart: Infinity };
    const seg = t.edl.find((s) => s.id === segId);
    if (!seg) return { minVStart: 0, maxVStart: Infinity };

    const dur = seg.srcEnd - seg.srcStart;
    const others = t.edl
      .filter((s) => s.id !== segId && !excludeIds.has(s.id))
      .sort((a, b) => a.vStart - b.vStart);

    const prev = others
      .filter((s) => s.vStart + (s.srcEnd - s.srcStart) <= seg.vStart)
      .sort((a, b) => b.vStart - a.vStart)[0];
    const next = others
      .filter((s) => s.vStart >= seg.vStart + dur)
      .sort((a, b) => a.vStart - b.vStart)[0];

    return {
      minVStart: prev ? prev.vStart + (prev.srcEnd - prev.srcStart) : 0,
      maxVEnd: next ? next.vStart : Infinity,
    };
  };

  // Raccourci clavier
  useEffect(() => {
    const onKey = (e) => {
      // Quand le focus est dans un champ de saisie ou dans l'éditeur de texte
      const target = e.target;
      const tag = target?.tagName;
      const isTyping =
        tag === "INPUT" || tag === "TEXTAREA" || !!target?.isContentEditable;
      if (isTyping) return;

      const isCmd = e.ctrlKey || e.metaKey;

      // Undo shortcut
      if (isCmd && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      // Redo shortcut
      else if (
        (isCmd && e.key.toLowerCase() === "y") ||
        (isCmd && e.shiftKey && e.key.toLowerCase() === "z")
      ) {
        e.preventDefault();
        redo();
      }
      // Copy shortcut
      else if (isCmd && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySelection();
      }
      // Paste shortcut
      else if (isCmd && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteAtCursor();
      }
      // Cut shortcut
      else if (isCmd && e.key.toLowerCase() === "x") {
        e.preventDefault();
        cutSelection();
      }
      // Suppr/Backspace : selon le contexte
      else if (e.key === "Delete" || e.key === "Backspace") {
        if (clipSelection.length > 0) {
          e.preventDefault();
          deleteSelectedClips();
        } else if (regionSelection) {
          e.preventDefault();
          deleteRegionWithoutCopy();
        }
      }
      // Echap : efface la sélection de clips
      else if (e.key === "Escape") {
        if (clipSelection.length > 0) clearClipSelection();
      }
      // Espace : Play / Pause
      else if (e.key === " ") {
        e.preventDefault();
        if (isPlaying) stop();
        else play();
      }
      // S : Split sur le Playherd
      else if (e.key === "s") {
        e.preventDefault();
        splitAtPlayhead();
      } else if (isCmd && e.key === "a") {
        e.preventDefault();
        selectAllClips();
      } else if (isCmd && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomBy(1.5);
      } else if (isCmd && e.key === "-") {
        e.preventDefault();
        zoomBy(1 / 1.5);
      } else if (isCmd && e.key === "0") {
        e.preventDefault();
        resetZoom();
      } else if (
        e.shiftKey &&
        (e.key === "ArrowLeft" || e.key === "ArrowRight")
      ) {
        e.preventDefault();
        nudgeSelectedClips(
          e.key === "ArrowLeft" ? -snapStep / 10 : snapStep / 10,
          !e.repeat,
        );
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        nudgeSelectedClips(
          e.key === "ArrowLeft" ? -snapStep : snapStep,
          !e.repeat,
        );
      }
      // R : Record
      else if (e.key.toLowerCase() === "r" && !isCmd) {
        e.preventDefault();
        if (isRecording) stopRecording();
        else record();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    past,
    future,
    tracks,
    selection,
    regionSelection,
    clipboard,
    clipSelection,
    isPlaying,
    isRecording,
    playerHeadTime,
    zoomBy,
    resetZoom,
  ]);

  // Affiche le GestureIcon à côté du curseur tant que Ctrl/Cmd est maintenu.
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onDown = (e) => {
      if (e.key === "Control" || e.key === "Meta") setCtrlHeld(true);
    };
    const onUp = (e) => {
      if (e.key === "Control" || e.key === "Meta") setCtrlHeld(false);
    };
    // Au cas où la fenêtre perd le focus pendant qu'on maintient la touche.
    const onBlur = () => setCtrlHeld(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (!ctrlHeld) return;
    const onMove = (e) => setCursorPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [ctrlHeld]);

  const undo = () => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [tracks, ...f]);
    setTracks(prev);
  };

  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, tracks]);
    setTracks(next);
  };

  // Split à la position du playhead (suit le curseur en lecture).
  // Si une région est sélectionnée, on découpe aux DEUX bords de la région
  // (start puis end) : la portion sélectionnée devient un clip indépendant.
  const splitAtPlayhead = () => {
    if (regionSelection) {
      const { trackId, start, end } = regionSelection;
      setTracksWithHistory((ts) =>
        ts.map((t) =>
          t.id === trackId
            ? { ...t, edl: splitAt(splitAt(t.edl, start), end) }
            : t,
        ),
      );
      setRegionSelection(null);
      return;
    }
    const trackId = isPlaying
      ? playingFromRef.current?.trackId
      : selection?.trackId;
    if (trackId == null) return;
    const time = isPlaying
      ? (playingFromRef.current?.startTime ?? 0) + playerHeadTime
      : (selection?.time ?? 0);
    setTracksWithHistory((ts) =>
      ts.map((t) =>
        t.id === trackId ? { ...t, edl: splitAt(t.edl, time) } : t,
      ),
    );
  };

  const selectAllClips = () => {
    const all = [];
    for (const t of tracks)
      for (const s of t.edl) all.push({ trackId: t.id, segId: s.id });
    setClipSelection(all);
    clipSelectionAnchorRef.current = all[0] ?? null;
    setRegionSelection(null);
  };

  // Nudge des clips sélectionnés.
  // `pushHistory = true` au premier keydown → on push l'état dans `past`
  // (= une entrée d'undo pour toute la session de touche maintenue).
  // `pushHistory = false` sur les repeats → on met juste à jour `tracks`
  // sans empiler de nouvelle entrée. L'undo ramène à l'état pré-session.
  const nudgeSelectedClips = (deltaSec, pushHistory = true) => {
    if (clipSelection.length === 0) return;
    const byTrack = new Map();
    for (const { trackId, segId } of clipSelection) {
      if (!byTrack.has(trackId)) byTrack.set(trackId, new Set());
      byTrack.get(trackId).add(segId);
    }

    // Les clips sélectionnés se déplacent tous du même delta. On clampe ce
    // delta pour qu'aucun clip n'empiète sur un voisin NON sélectionné (les
    // voisins sélectionnés bougent ensemble, donc ne contraignent pas).
    // maxRight / maxLeft = marge disponible avant de toucher un voisin.
    const vEnd = (s) => s.vStart + (s.srcEnd - s.srcStart);
    let maxRight = Infinity;
    let maxLeft = Infinity;
    for (const t of tracks) {
      const ids = byTrack.get(t.id);
      if (!ids) continue;
      const sorted = [...t.edl].sort((a, b) => a.vStart - b.vStart);
      sorted.forEach((s, i) => {
        if (!ids.has(s.id)) return;
        const rightNb = sorted[i + 1];
        if (rightNb && !ids.has(rightNb.id)) {
          maxRight = Math.min(maxRight, rightNb.vStart - vEnd(s));
        }
        const leftNb = sorted[i - 1];
        if (leftNb && !ids.has(leftNb.id)) {
          maxLeft = Math.min(maxLeft, s.vStart - vEnd(leftNb));
        } else if (!leftNb) {
          // Pas de voisin gauche : limite au début de la piste (0).
          maxLeft = Math.min(maxLeft, s.vStart);
        }
      });
    }

    const clampedDelta =
      deltaSec > 0
        ? Math.max(0, Math.min(deltaSec, maxRight))
        : Math.min(0, Math.max(deltaSec, -maxLeft));
    // Déjà collé à la limite : ne rien faire (évite d'empiler des undos vides).
    if (clampedDelta === 0) return;
    deltaSec = clampedDelta;

    const updater = (ts) =>
      ts.map((t) => {
        const ids = byTrack.get(t.id);
        if (!ids) return t;
        return {
          ...t,
          edl: t.edl.map((s) =>
            ids.has(s.id)
              ? { ...s, vStart: Math.max(0, s.vStart + deltaSec) }
              : s,
          ),
        };
      });
    if (pushHistory) {
      setTracksWithHistory(updater);
    } else {
      setTracks(updater);
    }
  };

  // Drag de groupe : déplace tous les clips sélectionnés du même delta.
  // Punch-in comme le drag mono : on retire d'abord TOUS les segments
  // sélectionnés (pour qu'ils ne se coupent pas entre eux), puis on les
  // réinsère à vStart + delta ; insertSegmentAt coupe ce qui chevauche
  // chez les non-sélectionnés. Un seul setTracksWithHistory = un seul undo.
  const moveClipsBy = (deltaSec) => {
    if (clipSelection.length === 0) return;

    // Clamp global : le clip le plus à gauche du groupe ne passe pas sous 0.
    // (PAS de Math.max(0, ...) par clip : ça compresserait les écarts.)
    let minVStart = Infinity;
    for (const { trackId, segId } of clipSelection) {
      const t = tracks.find((x) => x.id === trackId);
      const s = t?.edl.find((x) => x.id === segId);
      if (s) minVStart = Math.min(minVStart, s.vStart);
    }
    const delta = Math.max(deltaSec, -minVStart);
    if (Math.abs(delta) < 0.001) return;

    const byTrack = new Map();
    for (const { trackId, segId } of clipSelection) {
      if (!byTrack.has(trackId)) byTrack.set(trackId, new Set());
      byTrack.get(trackId).add(segId);
    }

    setTracksWithHistory((ts) =>
      ts.map((t) => {
        const ids = byTrack.get(t.id);
        if (!ids) return t;
        const moved = t.edl.filter((s) => ids.has(s.id));
        let edl = t.edl.filter((s) => !ids.has(s.id));
        // Tri par vStart : réinsertion gauche → droite, déterministe.
        for (const s of [...moved].sort((a, b) => a.vStart - b.vStart)) {
          edl = insertSegmentAt(edl, s, s.vStart + delta);
        }
        return { ...t, edl };
      }),
    );
  };

  // Drag intra-piste : punch-in à la nouvelle position absolue.
  // On retire d'abord le segment source (pour qu'insertSegmentAt ne le
  // coupe pas avec lui-même), puis on l'insère : cutRange efface ce qui
  // chevauche [newVStart, newVStart + dur].
  const moveClip = (trackId, segId, newVStart) => {
    setTracksWithHistory((ts) =>
      ts.map((t) => {
        if (t.id !== trackId) return t;
        const seg = t.edl.find((s) => s.id === segId);
        if (!seg) return t;
        const withoutSrc = removeSegment(t.edl, segId);
        return { ...t, edl: insertSegmentAt(withoutSrc, seg, newVStart) };
      }),
    );
  };

  const moveClipAcrossTracks = (srcTrackId, dstTrackId, segId, newVStart) => {
    if (srcTrackId === dstTrackId) return;
    const srcTrack = tracks.find((t) => t.id === srcTrackId);
    if (!srcTrack) return;
    const seg = srcTrack.edl.find((s) => s.id === segId);
    if (!seg) return;

    // Préserve buffer + bufferTrackId. Si le segment n'en avait pas (= clip "natif" de la piste source), on les remplit maintenant : sinon le segment basculerait sur le buffer de la piste cible et lirait le mauvais son.
    const portableSeg = {
      ...seg,
      buffer: seg.buffer ?? srcTrack.buffer,
      bufferTrackId: seg.bufferTrackId ?? srcTrack.id,
    };

    setTracksWithHistory((ts) =>
      ts.map((t) => {
        if (t.id === srcTrackId) {
          return { ...t, edl: removeSegment(t.edl, segId) };
        }
        if (t.id === dstTrackId) {
          const next = insertSegmentAt(t.edl, portableSeg, newVStart);
          return { ...t, edl: next };
        }
        return t;
      }),
    );
  };

  const trimClip = (trackId, segId, deltaLeft, deltaRight) => {
    setTracksWithHistory((ts) =>
      ts.map((t) =>
        t.id === trackId
          ? { ...t, edl: trimSegment(t.edl, segId, deltaLeft, deltaRight) }
          : t,
      ),
    );
  };

  const platform = navigator.userAgentData?.platform || navigator.platform;
  const ctrlKeyTitle = platform?.includes("Mac") ? "Cmd" : "Ctrl";

  return (
    <Box sx={{ width: "100%", p: 2, boxSizing: "border-box" }}>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{
          border: "2px solid #777",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          rowGap: 0.5,
          width: "100%",
          maxWidth: "100%",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          alignItems="center"
          sx={{
            minWidth: 0,
            maxWidth: "100%",
            flexWrap: "wrap",
            rowGap: 0.5,
          }}
        >
          <Box
            sx={{
              color: "#666",
              paddingLeft: 2,
              fontWeight: "bold",
              fontSize: 14,
            }}
          >
            {formatTime(displayTime, true)}
          </Box>

          <Tooltip title="Cursor to start">
            <span>
              <IconButton
                size="small"
                onClick={cursorToStart}
                disabled={tracks.length === 0}
              >
                <CursorToStartIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={isPlaying ? "Stop (space)" : "Play (space)"}>
            <span>
              <IconButton
                size="small"
                onClick={isPlaying ? stop : play}
                disabled={tracks.length === 0}
              >
                {isPlaying ? <StopIcon /> : <PlayArrowIcon />}
              </IconButton>
            </span>
          </Tooltip>
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <Tooltip title={isRecording ? "Stop recording (R)" : "Record (R)"}>
              <span>
                <IconButton
                  size="small"
                  onClick={isRecording ? stopRecording : record}
                  color={isRecording ? "error" : "default"}
                  disabled={!paths}
                  sx={{ pr: 0.25 }}
                >
                  {isRecording ? <StopIcon /> : <MicIcon />}
                </IconButton>
              </span>
            </Tooltip>
            <MicSourcePicker
              source={audioSource}
              onChange={changeAudioSource}
              audioCtxRef={audioCtxRef}
              disabled={isRecording}
            />
          </Box>
          <Tooltip title={`Copy (${ctrlKeyTitle} + C)`}>
            <span>
              <IconButton
                size="small"
                onClick={copySelection}
                disabled={!regionSelection && clipSelection.length === 0}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Paste (Ctrl + V)">
            <span>
              <IconButton
                size="small"
                onClick={pasteAtCursor}
                disabled={!clipboard || !selection}
              >
                <ContentPasteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Cut (Ctrl + X)">
            <span>
              <IconButton
                size="small"
                onClick={cutSelection}
                disabled={!regionSelection && clipSelection.length === 0}
              >
                <ContentCutIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Split at cursor / selected region (S)">
            <span>
              <IconButton
                size="small"
                onClick={splitAtPlayhead}
                disabled={!regionSelection && !selection && !isPlaying}
              >
                <SplitIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Undo (Ctrl + Z)">
            <span>
              <IconButton
                size="small"
                onClick={undo}
                disabled={past.length === 0}
              >
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Redo (Ctrl + Y)">
            <span>
              <IconButton
                size="small"
                onClick={redo}
                disabled={future.length === 0}
              >
                <RedoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Box sx={{ width: 8 }} />
          <Tooltip title={`Zoom out (${ctrlKeyTitle} + -)`}>
            <span>
              <IconButton
                size="small"
                onClick={() => zoomBy(1 / 1.5)}
                disabled={zoom <= ZOOM_MIN}
              >
                <ZoomOutIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={`Reset zoom (${ctrlKeyTitle} + 0)`}>
            <Box
              component="span"
              onClick={resetZoom}
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 38,
                fontSize: 12,
                color: "#666",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              {Math.round(zoom * 100)}%
            </Box>
          </Tooltip>
          <Tooltip title={`Zoom in (${ctrlKeyTitle} + +)`}>
            <span>
              <IconButton
                size="small"
                onClick={() => zoomBy(1.5)}
                disabled={zoom >= ZOOM_MAX}
              >
                <ZoomInIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip
            title={
              <Box sx={{ whiteSpace: "pre-line" }}>
                {`${ctrlKeyTitle} + Click to multiple select
                ← and → to move selection`}
              </Box>
            }
          >
            <IconButton size="small" disableRipple sx={{ cursor: "default" }}>
              <HelpOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Box sx={{ border: "2px solid #777", borderTop: "0px solid #777" }}>
        {/* ── Zone scrollable horizontalement : axe + pistes ── */}
        <Box
          ref={scrollRef}
          sx={{
            overflowX: "auto",
            overflowY: "hidden",
            // évite le "swipe back" du navigateur pendant le pan horizontal
            overscrollBehaviorX: "contain",
          }}
        >
          <Stack direction="row" alignItems="stretch">
            <Box
              sx={{
                width: contentWidth,
                flexShrink: 0,
                position: "relative",
                height: 16,
                paddingBottom: 0,
              }}
            >
              <TimelineAxis
                projectDuration={projectDuration}
                pxPerSec={pxPerSec}
                isTopAxis={true}
              />
            </Box>
            <Stack
              spacing={0}
              paddingRight={3}
              paddingLeft={1}
              margin={0}
              sx={{
                position: "sticky",
                right: 0,
                zIndex: 3,
                borderLeft: "1px solid #777",
                background: "#fff",
                flexShrink: 0,
                width: NAME_COL_W,
                boxSizing: "border-box",
              }}
            >
              <Box minWidth={NAME_COL_INNER_W} maxWidth={NAME_COL_INNER_W} />
            </Stack>
          </Stack>

          {tracks.length > 0 ? (
            tracks.map((t, idx) => {
              const isSel = selection?.trackId === t.id;
              // Le playhead suit la piste qu'on a *réellement* lancée,
              // pas la sélection en cours (qui peut changer pendant la lecture).
              const isLivePlay =
                isPlaying && playingFromRef.current?.trackId === t.id;
              const playheadTime = isLivePlay
                ? (playingFromRef.current?.startTime ?? 0) + playerHeadTime
                : selection?.trackId === t.id
                  ? selection.time
                  : null;
              return (
                <TrackView
                  key={t.id}
                  track={t}
                  projectDuration={projectDuration}
                  isSelected={isSel}
                  isMainTrack={idx === 0}
                  onSeek={handleSeek}
                  onDelete={() => deleteTrack(t.id)}
                  playheadTime={playheadTime}
                  regionSelection={regionSelection}
                  onRegionChange={setRegionSelection}
                  onRename={renameTrack}
                  pxPerSec={pxPerSec}
                  contentWidth={contentWidth}
                  onClipMove={moveClip}
                  onClipMoveAcrossTracks={moveClipAcrossTracks}
                  onClipsMoveBy={moveClipsBy}
                  onClipTrim={trimClip}
                  clipSelection={clipSelection}
                  onClipSelect={handleClipSelect}
                  onClearClipSelection={clearClipSelection}
                  getSnapCandidates={getSnapCandidates}
                  snapEnabled={snapEnabled}
                  snapStep={snapStep}
                  resizeBounds={getResizeBounds}
                  liveRecording={
                    isRecording && recordTarget?.trackId === t.id
                      ? {
                          peaksRef,
                          sampleHz,
                          startTime: recordTarget.startTime,
                        }
                      : null
                  }
                />
              );
            })
          ) : !isRecording ? (
            <Box
              sx={{
                color: "#666",
                p: 4,
                borderBottom: "1px solid #777",
                borderLeft: "1px solid #777",
                borderRight: "1px solid #777",
              }}
            >
              No tracks to display
            </Box>
          ) : null}
        </Box>

        {/* footer HORS du conteneur scrollé */}
        <Box sx={{ p: 1, borderTop: "1px solid #777" }}>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={addTrack}
            sx={{ color: "#666" }}
          >
            Add track
          </Button>
        </Box>
      </Box>

      {/* {ctrlHeld && (
                <Box
                    sx={{
                        position: "fixed",
                        top: cursorPos.y + 12,
                        left: cursorPos.x + 12,
                        pointerEvents: "none",
                        zIndex: 9999,
                        color: "#555",
                    }}
                >
                    <GestureIcon />
                </Box>
            )} */}
    </Box>
  );
}
