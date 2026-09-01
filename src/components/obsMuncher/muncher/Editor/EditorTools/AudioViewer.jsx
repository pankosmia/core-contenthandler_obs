import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import PlayArrowIcon from "@mui/icons-material/PlayArrowOutlined";
import StopIcon from "@mui/icons-material/StopOutlined";

import AudioViewerTrack from "./AudioViewerTrack";
import TimelineAxis from "./trackview/TimelineAxis";
import CursorToStartIcon from "./CursorToStartIcon";
import { formatTime } from "./Timeline";
import { computePeaks } from "./lib/waveform";

// Lecteur audio inspiré de l'éditeur (AudioRecorder) : même boîte, même grille
// (TimelineAxis) et une toolbar, mais réduite à l'essentiel pour un visualiseur
// en lecture seule. On garde : le temps, le retour au début, et play/stop.
// On retire : record, copy/paste/cut, split, undo/redo, zoom, drag & drop,
// clips éditables, la colonne de droite (nom de piste, edit), le "press R to
// record" et "add track".
//
// L'audio vient d'un unique mp3 ; il n'y a donc qu'une waveform et un playhead.
// La timeline est dimensionnée à la durée réelle de l'audio : la waveform et
// l'axe couvrent toute la largeur, sans scroll ni zoom.

const N_BINS = 4000;
const LANE_HEIGHT = 96;

const AudioViewer = ({ chapter, paragraph, metadata }) => {
  const cc = String(chapter).padStart(2, "0");
  const pp = String(paragraph).padStart(2, "0");
  const audioPath = `audio_content/${cc}-${pp}/${cc}-${pp}.mp3`;
  const audioUrl = `/api/burrito/ingredient/bytes/${metadata.local_path}?ipath=${audioPath}`;

  // AudioContext partagé pour décodage + lecture (resume au play, geste user).
  const audioCtxRef = useRef(null);
  const getCtx = () =>
    (audioCtxRef.current ??= new (
      window.AudioContext || window.webkitAudioContext
    )());

  const [peaks, setPeaks] = useState(null);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [playheadTime, setPlayheadTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [laneWidth, setLaneWidth] = useState(0);

  const bufferRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(null);
  const startInfoRef = useRef(null); // { ctxStart, offset } au lancement
  const playheadRef = useRef(0);
  playheadRef.current = playheadTime;
  const scrollRef = useRef(null);

  // pxPerSec : largeur disponible / durée → l'axe couvre exactement la largeur.
  const pxPerSec = duration > 0 && laneWidth > 0 ? laneWidth / duration : 0;

  // Mesure de la largeur disponible (pour graduer l'axe). Le visualiseur
  // n'est monté qu'une fois l'audio prêt (cf. early-return plus bas) : on
  // (re)mesure donc quand `status` change, sinon scrollRef.current serait
  // encore null au montage et la largeur resterait à 0.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setLaneWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setLaneWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [status]);

  // --- Lecture ---
  const stopSource = () => {
    const s = sourceRef.current;
    if (s) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* déjà arrêtée */
      }
      sourceRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  // Fin naturelle : on remet le playhead au début.
  const handleEnd = () => {
    stopSource();
    setIsPlaying(false);
    setPlayheadTime(0);
  };

  const tick = () => {
    const info = startInfoRef.current;
    const buf = bufferRef.current;
    if (!info || !buf) return;
    const t = info.offset + (getCtx().currentTime - info.ctxStart);
    if (t >= buf.duration) {
      setPlayheadTime(buf.duration);
      handleEnd();
      return;
    }
    setPlayheadTime(t);
    rafRef.current = requestAnimationFrame(tick);
  };

  const startFrom = (offsetSec) => {
    const buf = bufferRef.current;
    if (!buf) return;
    const ctx = getCtx();
    ctx.resume?.();
    stopSource();
    const clamped = Math.max(0, Math.min(offsetSec, buf.duration));
    const offset = clamped >= buf.duration ? 0 : clamped; // fin = repart à 0
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = handleEnd; // fin naturelle (stop manuel neutralise onended)
    src.start(0, offset);
    sourceRef.current = src;
    startInfoRef.current = { ctxStart: ctx.currentTime, offset };
    setPlayheadTime(offset);
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  };

  const play = () => startFrom(playheadRef.current);

  const stop = () => {
    stopSource();
    setIsPlaying(false); // playhead conservé là où il est
  };

  // Clic sur la waveform → déplace le playhead (et relance depuis là si on joue).
  const handleSeek = (t) => {
    setPlayheadTime(t);
    if (isPlaying) startFrom(t);
  };

  const cursorToStart = () => handleSeek(0);

  // Fetch + décodage du mp3 → buffer + peaks + durée. Relancé si l'URL change.
  useEffect(() => {
    let cancelled = false;
    stopSource();
    setIsPlaying(false);
    setPlayheadTime(0);
    setPeaks(null);
    setDuration(0);
    bufferRef.current = null;
    if (!audioUrl) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    (async () => {
      try {
        const r = await fetch(audioUrl);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = await getCtx().decodeAudioData(await r.arrayBuffer());
        if (cancelled) return;
        bufferRef.current = buf;
        setPeaks(computePeaks(buf.getChannelData(0), N_BINS));
        setDuration(buf.duration);
        setStatus("ready");
      } catch {
        if (!cancelled) {
          setPeaks(null);
          setDuration(0);
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  // Espace = play/stop (hors saisie texte), comme l'éditeur.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== " ") return;
      const tag = e.target?.tagName;
      const isTyping =
        tag === "INPUT" || tag === "TEXTAREA" || !!e.target?.isContentEditable;
      if (isTyping || status !== "ready") return;
      e.preventDefault();
      if (isPlaying) stop();
      else play();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, status]);

  // Nettoyage au démontage.
  useEffect(() => () => stopSource(), []);

  const ready = status === "ready";

  // On n'affiche RIEN tant qu'un audio n'est pas confirmé prêt : ni pendant le
  // chargement, ni en cas d'absence d'audio. Le visualiseur n'apparaît donc
  // qu'au moment où il y a effectivement quelque chose à montrer (pas de flash
  // « apparaît puis disparaît » sur les paragraphes sans audio).
  if (!ready) return null;

  return (
    <Box sx={{ width: "100%", p: 2 }}>
      {/* ── Toolbar réduite : temps · retour au début · play/stop ── */}
      <Stack
        direction="row"
        spacing={1}
        sx={{ border: "2px solid #777", alignItems: "center" }}
      >
        <Box
          sx={{
            color: "#666",
            paddingLeft: 2,
            fontWeight: "bold",
            fontSize: 14,
          }}
        >
          {formatTime(playheadTime, true)}
        </Box>
        <Tooltip title="Cursor to start">
          <span>
            <IconButton size="small" onClick={cursorToStart} disabled={!ready}>
              <CursorToStartIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={isPlaying ? "Stop (space)" : "Play (space)"}>
          <span>
            <IconButton
              size="small"
              onClick={isPlaying ? stop : play}
              disabled={!ready}
            >
              {isPlaying ? <StopIcon /> : <PlayArrowIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {/* ── Boîte + grille ── */}
      <Box sx={{ border: "2px solid #777", borderTop: "0px solid #777" }}>
        <Box ref={scrollRef} sx={{ overflow: "hidden" }}>
          <Box sx={{ position: "relative" }}>
            <TimelineAxis
              projectDuration={duration}
              pxPerSec={pxPerSec}
              isTopAxis={true}
            />
            <Box sx={{ height: 16 }} />
            <Box sx={{ position: "relative", zIndex: 1 }}>
              <AudioViewerTrack
                peaks={peaks}
                duration={duration}
                playheadTime={playheadTime}
                height={LANE_HEIGHT}
                onSeek={handleSeek}
              />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default AudioViewer;
