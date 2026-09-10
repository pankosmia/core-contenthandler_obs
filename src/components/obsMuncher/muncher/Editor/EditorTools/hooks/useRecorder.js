import { useRef, useState, useEffect } from "react";
import { makeTrack, makeSegment, overwriteAt } from "../lib/edl";
import { saveAudioBlob } from "../lib/storageUtil";
import { acquireStream, DEFAULT_SOURCE } from "../lib/audioSource";

// Encapsule MediaRecorder + persistance du blob + ajout d'une piste.
// Pendant l'enregistrement, sample les peaks via un AnalyserNode pour
// permettre l'affichage de la waveform en temps réel (peaksRef).
// La durée est exposée via `recordingDuration`, mise à jour à basse
// fréquence (5Hz) pour éviter de re-render toutes les pistes à 60Hz.

const SAMPLE_HZ = 30; // peaks par seconde
const DURATION_UPDATE_MS = 200;

export function useRecorder({
  paths,
  audioCtxRef,
  setTracks,
  tracksRef,
  pushHistory,
  source: inputSource,
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const startedAtRef = useRef(0);
  const peaksRef = useRef([]);
  const rafRef = useRef(null);
  const durationIntervalRef = useRef(null);
  const targetTrackIdRef = useRef(null);
  // Position (en s) où poser la prise sur la piste cible : suit le curseur,
  // comme la lecture démarre au curseur.
  const atTimeRef = useRef(0);

  const startRecording = async (targetTrackId = null, atTime = 0) => {
    targetTrackIdRef.current = targetTrackId;
    atTimeRef.current = atTime;
    if (!paths) return;
    audioCtxRef.current ??= new AudioContext();
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") await ctx.resume();

    const stream = await acquireStream(inputSource ?? DEFAULT_SOURCE);
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    sourceRef.current = source;
    analyserRef.current = analyser;
    peaksRef.current = [];

    const rec = new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try {
        source.disconnect();
      } catch {
        /* déjà déconnecté */
      }
      sourceRef.current = null;
      analyserRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (durationIntervalRef.current)
        clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
      peaksRef.current = [];
      setRecordingDuration(0);

      const blob = new Blob(chunksRef.current, { type: rec.mimeType });
      const buffer = await audioCtxRef.current.decodeAudioData(
        await blob.arrayBuffer(),
      );
      const targetId = targetTrackIdRef.current;
      const atTime = atTimeRef.current ?? 0;
      targetTrackIdRef.current = null;
      atTimeRef.current = 0;
      const target = tracksRef?.current?.find((t) => t.id === targetId);

      // Snapshot pré-prise pour que Ctrl+Z annule l'enregistrement.
      pushHistory?.();

      if (!target) {
        // Pas de piste cible : on crée une nouvelle piste (filet de sécurité).
        const id = crypto.randomUUID();
        await saveAudioBlob(paths, id, blob);
        setTracks((prev) => [
          ...prev,
          makeTrack(buffer, `Track - ${prev.length + 1}`, id),
        ]);
        return;
      }

      if (target.edl.length === 0 && !target.buffer) {
        // Première prise sur une piste vierge : modèle "buffer natif", sauvé
        // sous l'id de la piste (rechargé via track.id au reload).
        await saveAudioBlob(paths, target.id, blob);
        setTracks((prev) =>
          prev.map((t) =>
            t.id === target.id
              ? { ...t, buffer, edl: [makeSegment(atTime, 0, buffer.duration)] }
              : t,
          ),
        );
        return;
      }

      // Piste déjà remplie : on pose la prise au curseur en overwrite. C'est un
      // buffer étranger à la piste, sauvé sous son propre id et référencé via
      // bufferTrackId pour être ré-attaché au reload (cf. collectBufferIds).
      const bufId = crypto.randomUUID();
      await saveAudioBlob(paths, bufId, blob);
      const seg = makeSegment(0, 0, buffer.duration, buffer, bufId);
      setTracks((prev) =>
        prev.map((t) =>
          t.id === target.id
            ? { ...t, edl: overwriteAt(t.edl, atTime, [seg]) }
            : t,
        ),
      );
    };
    rec.start();
    mediaRecRef.current = rec;
    startedAtRef.current = ctx.currentTime;
    setIsRecording(true);

    // rAF: échantillonnage des peaks à SAMPLE_HZ depuis l'AnalyserNode.
    // On utilise un compteur de slots pour pousser exactement N peaks
    // par seconde, indépendamment de la cadence du rAF (souvent 60Hz).
    const buf = new Float32Array(analyser.fftSize);
    const sampleStep = 1 / SAMPLE_HZ;
    let nextSlot = 0;
    const tick = () => {
      if (!analyserRef.current) return;
      const elapsed = ctx.currentTime - startedAtRef.current;
      while (nextSlot + sampleStep <= elapsed) {
        analyserRef.current.getFloatTimeDomainData(buf);
        let max = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]);
          if (v > max) max = v;
        }
        peaksRef.current.push(max);
        nextSlot += sampleStep;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    // Update de durée à basse fréquence : suffit pour faire grandir la
    // timeline sans déclencher 60 re-renders/s de toutes les pistes.
    durationIntervalRef.current = setInterval(() => {
      setRecordingDuration(ctx.currentTime - startedAtRef.current);
    }, DURATION_UPDATE_MS);
  };

  const stopRecording = () => {
    mediaRecRef.current?.stop();
    setIsRecording(false);
  };

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (durationIntervalRef.current)
        clearInterval(durationIntervalRef.current);
    },
    [],
  );

  return {
    isRecording,
    startRecording,
    stopRecording,
    recordingDuration,
    peaksRef,
    sampleHz: SAMPLE_HZ,
  };
}
