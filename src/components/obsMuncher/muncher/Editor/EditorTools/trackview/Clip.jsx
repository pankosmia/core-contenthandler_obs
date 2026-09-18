import Box from "@mui/material/Box";
import ClipWaveform from "./ClipWaveform";

import { useRef, useEffect, useState } from "react";
import interact from "interactjs";
import { snapTime } from "../lib/snap";

// Un clip = un bloc visuel positionné en absolu sur la lane.
// left/width sont calculés depuis (seg.vStart, durée) et pxPerSec.
// INSET_X = 0 : les clips occupent leur largeur réelle, donc deux clips
// adjacents se touchent sans gap. L'espace de respiration n'existe plus
// par clip mais UNIQUEMENT au bord droit de la piste (RIGHT_EDGE_GAP).
const INSET_X = 0;
const INSET_Y = 2;
const HEADER_HEIGHT = 12;
// En-deçà de ce déplacement cumulé (px), on considère que c'est un clic et non
// un drag : évite qu'un micro-mouvement de la main pendant le clic n'avale la
// sélection du clip.
const DRAG_THRESHOLD_PX = 4;
// Marge réservée au bord droit de la lane : empêche le dernier clip (dont
// vEnd == projectDuration) de coller / déborder sur la bordure de séparation
// droite de la piste. Appliquée seulement à l'extrémité, pas entre les clips.
const RIGHT_EDGE_GAP = 3;

export default function Clip({
  segment,
  trackId,
  trackBuffer,
  pxPerSec,
  projectDuration,
  isSelected,
  onMove,
  onMoveAcrossTracks,
  // Commit du drag de groupe : tous les clips sélectionnés bougent du
  // même delta (en secondes). Géré par moveClipsBy dans AudioRecorder.
  onClipsMoveBy,
  onClipTrim,
  onSelect,
  getSnapCandidates,
  snapEnabled,
  snapStep,
  resizeBounds,
  clipSelection,
}) {
  const dur = segment.srcEnd - segment.srcStart;
  const left = segment.vStart * pxPerSec + INSET_X;
  // Largeur réelle → clips adjacents jointifs (pas de gap entre eux).
  let width = Math.max(0, dur * pxPerSec - INSET_X * 2);
  // On ne rogne qu'à l'extrémité droite de la piste : si le bord droit du clip
  // atteindrait (ou dépasserait) le bord de la lane, on le recule de
  // RIGHT_EDGE_GAP. Les clips internes ne sont jamais touchés.
  const laneWidth = projectDuration * pxPerSec;
  if (laneWidth > 0) {
    const maxRight = laneWidth - RIGHT_EDGE_GAP;
    if (left + width > maxRight) width = Math.max(0, maxRight - left);
  }

  // Interact.js pour le draggable
  const ref = useRef(null);
  const dragDxRef = useRef(0);
  // Rect au début du resize. e.deltaRect d'interact.js est INCRÉMENTAL
  // (delta depuis le previous event), pas cumulatif. À end(), il vaut donc
  // ~0. On capture le rect initial pour calculer le total via (e.rect - startRect).
  const resizeStartRectRef = useRef(null);
  // Handle impératif vers ClipWaveform : permet de translater le canvas
  // (qui contient la waveform du buffer ENTIER) pendant le resize, sans
  // re-render React → animation 60fps sans tremblement.
  const waveformRef = useRef(null);

  const dragDyRef = useRef(0);
  const hoveredTrackIdRef = useRef(trackId);

  // Suppression du clic (sélection) si un drag interact.js a RÉELLEMENT déplacé
  // le clip. interact.js déclenche start() dès 1-2px de mouvement (un clic qui
  // tremble), ce qui mangeait la sélection : on n'arme donc ce flag que dans
  // move(), une fois passé un seuil perceptible (DRAG_THRESHOLD_PX). Un clic
  // immobile garde le flag à false → la sélection passe du premier coup.
  const dragMovedRef = useRef(false);

  // Snap props refletées en refs pour que les listeners interact.js (capturés
  // une fois dans useEffect) lisent toujours la valeur courante sans devoir
  // ré-attacher interact.js à chaque toggle.
  const snapEnabledRef = useRef(snapEnabled);
  snapEnabledRef.current = snapEnabled;
  const snapStepRef = useRef(snapStep);
  snapStepRef.current = snapStep;
  const getSnapCandidatesRef = useRef(getSnapCandidates);
  getSnapCandidatesRef.current = getSnapCandidates;

  // Snap vertical
  const dragStartTopRef = useRef(null);

  // Resize bounds
  const resizeBoundsRef = useRef(resizeBounds);
  resizeBoundsRef.current = resizeBounds;
  const clampedRectRef = useRef(null);

  const clipSelectionRef = useRef(clipSelection);
  clipSelectionRef.current = clipSelection;

  // pxPerSec, le segment et les callbacks de commit reflétés en refs : sinon ils
  // entrent dans les deps de l'effet interact.js plus bas, qui se ré-attache
  // alors (unset + draggable + resizable) à CHAQUE render — donc à chaque frame
  // de zoom et pour chaque clip. Ré-instancier interact.js en continu était la
  // cause principale du lag (surtout au trackpad, flux d'events dense). Avec les
  // refs, l'effet ne tourne plus qu'une fois (au montage) et les listeners
  // lisent toujours les valeurs courantes.
  const pxPerSecRef = useRef(pxPerSec);
  pxPerSecRef.current = pxPerSec;
  const segmentRef = useRef(segment);
  segmentRef.current = segment;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onMoveAcrossTracksRef = useRef(onMoveAcrossTracks);
  onMoveAcrossTracksRef.current = onMoveAcrossTracks;
  const onClipTrimRef = useRef(onClipTrim);
  onClipTrimRef.current = onClipTrim;
  const onClipsMoveByRef = useRef(onClipsMoveBy);
  onClipsMoveByRef.current = onClipsMoveBy;

  // Éléments DOM des co-sélectionnés pendant un drag de groupe, capturés une
  // seule fois au franchissement du seuil (pas de querySelector par move()).
  // null = drag mono.
  const groupElsRef = useRef(null);

  // Retourne la liste des clips du groupe si le clip saisi fait partie d'une
  // sélection multiple, sinon null (= drag mono, comportement actuel).
  const getDragGroup = () => {
    const sel = clipSelectionRef.current ?? [];
    const inSel = sel.some(
      (c) => c.trackId === trackId && c.segId === segment.id,
    );
    return inSel && sel.length > 1 ? sel : null;
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Calcule le dx à afficher en pixels à partir du dx brut du curseur.
    // Applique le snap si activé et qu'on est resté sur la piste source
    // (les candidates de snap sont ceux de cette piste). Alt = bypass.
    // Snap aux deux bords (left/right) ; si les deux snappent, on prend
    // le plus proche du curseur ; si un seul snappe, on prend celui-là.
    const computeSnappedDx = (rawDx, altKey, dstTrackId) => {
      const pxPerSec = pxPerSecRef.current;
      const segment = segmentRef.current;
      if (!snapEnabledRef.current || altKey || pxPerSec <= 0) {
        return rawDx;
      }

      const sameTrack = dstTrackId === trackId;
      const group = getDragGroup();
      const excludeIds = group
        ? new Set(
            group.filter((c) => c.trackId === trackId).map((c) => c.segId),
          )
        : sameTrack
          ? segment.id
          : null;
      const rawCandidates =
        getSnapCandidatesRef.current?.(dstTrackId, excludeIds) ?? [];
      const segDur = segment.srcEnd - segment.srcStart;
      const rawV = segment.vStart + rawDx / pxPerSec;
      const snapStepCur = snapStepRef.current;

      // Snap UNIQUEMENT par le bord gauche (vStart) : ça garantit que la
      // position visuelle du clip s'aligne sur les ticks affichés.
      // Pour préserver le snap "bord droit touche un voisin", on étend
      // les candidates avec `c - segDur` : ces valeurs représentent les
      // positions où vStart doit être pour que vEnd s'aligne sur `c`.
      const candidates = [
        ...rawCandidates,
        ...rawCandidates.map((c) => c - segDur),
      ];

      // Threshold = snapStep / 2 → la grille la plus proche gagne TOUJOURS.
      // Le clip est en permanence sur un tick pendant le drag (hard snap).
      // Pas de filtre directionnel : la nearest-grid attire des deux côtés,
      // comportement standard "always-on-grid". Alt = bypass.
      const thresholdSec = snapStepCur / 2;

      const snapped = snapTime(rawV, {
        snapStep: snapStepCur / 2,
        candidates,
        thresholdSec,
      });
      return (snapped - segment.vStart) * pxPerSec;
    };

    interact(el).draggable({
      // Le drag-move ne s'arme qu'à partir du header. Un drag sur le corps
      // bubble vers la lane pour devenir une sélection de région intra-clip.
      allowFrom: "[data-clip-header]",
      listeners: {
        start() {
          const clipRect = el.getBoundingClientRect();
          dragStartTopRef.current = clipRect.top;

          // Pas encore un vrai drag : on attend de dépasser le seuil dans move().
          // SURTOUT ne rien armer ici (ni classes, ni pointerEvents) :
          // `pointerEvents = "none"` posé dès start() rendait le clip
          // transparent au mouseup d'un simple clic qui tremble de 1-2px →
          // la cible du mouseup devenait la lane, le navigateur ne
          // dispatchait jamais de `click` sur le header, et la sélection
          // échouait aléatoirement (il fallait recliquer).
          dragMovedRef.current = false;
        },
        move(e) {
          const segment = segmentRef.current;
          // dragDxRef = cumul brut du curseur, JAMAIS écrasé par le snap.
          // Sinon le snap suivant se calcule par rapport à la position
          // snappée et il faut s'éloigner du threshold depuis là pour
          // libérer — au lieu de se baser sur la position du curseur.
          dragDxRef.current += e.dx;
          dragDyRef.current += e.dy;

          // En-deçà du seuil : on ne touche à rien (ni transform, ni
          // pointerEvents). Si le geste s'arrête là, c'est un clic et le
          // header doit recevoir le mouseup/click normalement.
          if (
            !dragMovedRef.current &&
            Math.hypot(dragDxRef.current, dragDyRef.current) <=
              DRAG_THRESHOLD_PX
          ) {
            return;
          }

          // Premier franchissement du seuil → vrai drag : on arme le visuel
          // de drag maintenant (et le clic de fin ne sélectionnera pas).
          if (!dragMovedRef.current) {
            dragMovedRef.current = true;
            el.classList.add("dragging");
            document.body.classList.add("clip-dragging");
            // Élève le clip au-dessus des autres pendant le drag pour qu'il
            // passe visuellement par-dessus les autres lanes.
            el.style.zIndex = "10";
            el.style.pointerEvents = "none"; // pour que elementFromPoint voie la lane sous le clip

            // Drag de groupe : capture les éléments DOM des co-sélectionnés
            // (les data-clip-id sont des UUID, uniques toutes lanes
            // confondues, donc querySelector global suffit). pointerEvents
            // none aussi sur eux : un membre du groupe qui passe sous le
            // curseur ne doit pas intercepter le mouseup.
            const group = getDragGroup();
            if (group) {
              groupElsRef.current = group
                .filter((c) => c.segId !== segment.id)
                .map((c) =>
                  document.querySelector(`[data-clip-id="${c.segId}"]`),
                )
                .filter(Boolean);
              for (const gEl of groupElsRef.current) {
                gEl.classList.add("dragging");
                gEl.style.zIndex = "10";
                gEl.style.pointerEvents = "none";
              }
            } else {
              groupElsRef.current = null;
            }
          }

          const isGroup = !!groupElsRef.current;

          // En mode groupe : horizontal only. Pas de hit-test de lane (on
          // reste sur la piste source, hoveredTrackIdRef n'est pas touché)
          // et dy forcé à 0.
          let overTrackId = trackId;
          let displayDy = 0;
          if (!isGroup) {
            // Hit-test : trouve la lane sous le pointeur.
            const under = document.elementFromPoint(e.client.x, e.client.y);
            const laneEl = under?.closest("[data-lane-id]");
            overTrackId = laneEl?.dataset.laneId ?? hoveredTrackIdRef.current;
            hoveredTrackIdRef.current = overTrackId;

            displayDy = dragDyRef.current; // fallback
            if (laneEl) {
              const laneRect = laneEl.getBoundingClientRect();
              displayDy = laneRect.top - dragStartTopRef.current + INSET_Y;
            }
          }

          const altKey = e.altKey ?? e.originalEvent?.altKey ?? false;
          const displayDx = computeSnappedDx(
            dragDxRef.current,
            altKey,
            overTrackId,
          );

          el.style.transform = `translate(${displayDx}px, ${displayDy}px)`;
          if (isGroup) {
            for (const gEl of groupElsRef.current) {
              gEl.style.transform = `translateX(${displayDx}px)`;
            }
          }
        },
        end(e) {
          // Seuil jamais franchi = simple clic : rien n'a été armé dans
          // move(), rien à défaire ni à déplacer. Sans ce garde, le snap
          // pouvait transformer un drag d'1px en saut sur le tick voisin.
          if (!dragMovedRef.current) {
            dragDxRef.current = 0;
            dragDyRef.current = 0;
            hoveredTrackIdRef.current = trackId;
            return;
          }

          const pxPerSec = pxPerSecRef.current;
          const segment = segmentRef.current;
          const dstTrackId = hoveredTrackIdRef.current;
          const altKey = e.altKey ?? e.originalEvent?.altKey ?? false;
          const finalDx = computeSnappedDx(
            dragDxRef.current,
            altKey,
            dstTrackId,
          );
          const deltaSec = pxPerSec > 0 ? finalDx / pxPerSec : 0;

          // Reset visuel. Indispensable aussi pour le groupe : React ne
          // nettoie pas les style.transform posés impérativement.
          const wasGroup = !!groupElsRef.current;
          el.style.transform = "";
          el.style.zIndex = "";
          el.style.pointerEvents = "";
          el.classList.remove("dragging");
          if (groupElsRef.current) {
            for (const gEl of groupElsRef.current) {
              gEl.style.transform = "";
              gEl.style.zIndex = "";
              gEl.style.pointerEvents = "";
              gEl.classList.remove("dragging");
            }
            groupElsRef.current = null;
          }
          document.body.classList.remove("clip-dragging");
          document
            .querySelectorAll("[data-lane-id].drop-target")
            .forEach((n) => n.classList.remove("drop-target"));
          dragDxRef.current = 0;
          dragDyRef.current = 0;
          hoveredTrackIdRef.current = trackId;

          if (wasGroup) {
            if (Math.abs(deltaSec) < 0.001) return;
            onClipsMoveByRef.current?.(deltaSec);
            return;
          }
          // --- mode mono : comportement actuel inchangé ---
          if (Math.abs(deltaSec) < 0.001 && dstTrackId === trackId) return;
          const newVStart = Math.max(0, segment.vStart + deltaSec);
          if (dstTrackId === trackId) {
            onMoveRef.current?.(trackId, segment.id, newVStart);
          } else {
            onMoveAcrossTracksRef.current?.(
              trackId,
              dstTrackId,
              segment.id,
              newVStart,
            );
          }
        },
      },
    });
    interact(el).resizable({
      // Bords détectés via des poignées explicites (et non la marge automatique).
      // La marge par défaut (20px) recouvre tout un clip étroit, header compris :
      // le resizeChecker réclamait alors l'action et, le header étant réservé au
      // drag, plus rien ne se déclenchait. Avec des poignées limitées au corps du
      // clip, le header n'est jamais une zone de resize → le drag prend le relais.
      edges: {
        left: "[data-resize-left]",
        right: "[data-resize-right]",
        top: false,
        bottom: false,
      },
      listeners: {
        start(e) {
          resizeStartRectRef.current = {
            left: e.rect.left,
            right: e.rect.right,
          };
          clampedRectRef.current = null;
        },
        move(e) {
          const pxPerSec = pxPerSecRef.current;
          const segment = segmentRef.current;
          const start = resizeStartRectRef.current;
          if (!start || pxPerSec <= 0) return;

          const { minVStart, maxVEnd } = resizeBoundsRef.current?.(
            trackId,
            segment.id,
          ) ?? { minVStart: 0, maxVEnd: Infinity };

          // Convertit les bornes (en secondes vTime) → en pixels relatifs au clip
          const segLeftPx0 = segment.vStart * pxPerSec + INSET_X; // position d'origine
          const minLeftPx = minVStart * pxPerSec + INSET_X;
          const maxRightPx =
            (maxVEnd === Infinity
              ? Number.MAX_SAFE_INTEGER
              : maxVEnd * pxPerSec) - INSET_X;

          // Clamp e.rect.left / e.rect.right (en coordonnées viewport)
          // Utiliser laneEl.getBoundingClientRect().left pour convertir
          const laneEl = el.parentElement; // ou via data-lane-id
          const laneLeft = laneEl.getBoundingClientRect().left;
          const clampedLeft = Math.max(laneLeft + minLeftPx, e.rect.left);
          const clampedRight = Math.min(laneLeft + maxRightPx, e.rect.right);

          // Largeur minimale = 1px pour ne pas inverser le clip
          if (clampedRight - clampedLeft < 1) return;

          const dxLeft = clampedLeft - start.left;
          el.style.transform = `translateX(${dxLeft}px)`;
          el.style.width = `${clampedRight - clampedLeft}px`;

          clampedRectRef.current = {
            left: clampedLeft,
            right: clampedRight,
          };

          const newSrcStartPx = segment.srcStart * pxPerSec + dxLeft;
          waveformRef.current?.setSrcStartPx(newSrcStartPx);
        },
        end() {
          const pxPerSec = pxPerSecRef.current;
          const segment = segmentRef.current;
          const start = resizeStartRectRef.current;
          const finalRect = clampedRectRef.current; // capturer AVANT reset
          el.style.transform = "";
          el.style.width = "";
          resizeStartRectRef.current = null;
          clampedRectRef.current = null;
          if (!start || pxPerSec <= 0) return;
          if (!finalRect) return;
          const deltaLeft = (finalRect.left - start.left) / pxPerSec;
          const deltaRight = (finalRect.right - start.right) / pxPerSec;
          if (Math.abs(deltaLeft) > 0.001 || Math.abs(deltaRight) > 0.001) {
            onClipTrimRef.current?.(trackId, segment.id, deltaLeft, deltaRight);
          }
          // La waveform sera repositionnée par React au prochain
          // render via la prop left de ClipWaveform.
        },
      },
    });
    return () => interact(el).unset();
    // Volontairement monté une seule fois : pxPerSec, le segment et les
    // callbacks sont lus via refs dans les listeners (voir plus haut), donc
    // interact.js n'est jamais ré-attaché sur un changement de zoom/render.
  }, [trackId, segment.id]);

  // Chaque geste repart d'un flag propre. Indispensable : après un vrai drag,
  // le `click` n'atteint pas le header (pointerEvents était "none" au moment
  // du mouseup), donc onHeaderClick ne consomme jamais le flag — sans ce
  // reset, le clic immobile SUIVANT serait avalé par le garde (il fallait
  // cliquer deux fois après avoir déplacé un clip).
  const onHeaderPointerDown = () => {
    dragMovedRef.current = false;
  };

  const onHeaderClick = (e) => {
    // Si un drag interact.js a eu lieu, on n'enclenche pas la sélection.
    // Pas de stopPropagation : interact.js (attaché au parent) doit pouvoir
    // recevoir le pointerdown. La lane ignore déjà les pointerdown issus
    // du header via [data-clip-header].
    if (dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    onSelect?.(trackId, segment.id, {
      ctrlKey: e.ctrlKey || e.metaKey,
      shiftKey: e.shiftKey,
    });
  };

  // Double-clic n'importe où sur le clip = sélection du clip entier. Le header
  // (seul point de sélection au simple clic) ne fait que 12px de haut et est
  // donc difficile à viser ; double-cliquer sur le corps offre une cible large.
  // Les simples clics du corps posent le playhead ; le dblclick final
  // (toujours dispatché après les click) sélectionne le clip.
  const onClipDoubleClick = (e) => {
    onSelect?.(trackId, segment.id, {
      ctrlKey: e.ctrlKey || e.metaKey,
      shiftKey: e.shiftKey,
    });
  };

  return (
    <Box
      ref={ref}
      data-clip-id={segment.id}
      onDoubleClick={onClipDoubleClick}
      sx={{
        position: "absolute",
        boxSizing: "border-box",
        left: `${left}px`,
        width: `${width}px`,
        top: INSET_Y,
        bottom: INSET_Y,
        border: isSelected
          ? "1.5px solid #1565c0"
          : "1px solid rgb(21, 119, 137)",
        borderRadius: "5px",
        background: isSelected
          ? "rgba(34, 173, 197, 0.32)"
          : "rgba(34, 173, 197, 0.22)",
        boxShadow: isSelected
          ? "0 0 0 1px #1565c0, 0 2px 4px rgba(0, 0, 0, 0.22)"
          : "0 1px 2px rgba(0, 0, 0, 0.18)",
        overflow: "hidden",
        transition: "box-shadow 120ms ease, background 120ms ease",
        display: "flex",
        flexDirection: "column",
        // Hover seulement sur les clips NON sélectionnés : sinon il écrase
        // boxShadow/background et fait "disparaître" l'effet de sélection
        // tant que le curseur est sur le clip.
        "&:hover": isSelected
          ? {}
          : {
              boxShadow:
                "0 0 0 1px rgba(34, 173, 197, 0.7), 0 1px 2px rgba(0, 0, 0, 0.22)",
              background: "rgba(34, 173, 197, 0.28)",
            },
      }}
    >
      <Box
        data-clip-header={segment.id}
        onPointerDown={onHeaderPointerDown}
        onClick={onHeaderClick}
        sx={{
          height: HEADER_HEIGHT,
          background: isSelected
            ? "linear-gradient(180deg, rgba(21,119,137,0.95), rgba(21,119,137,0.75))"
            : "linear-gradient(180deg, rgba(21,119,137,0.85), rgba(21,119,137,0.55))",
          borderBottom: "1px solid rgba(0, 0, 0, 0.15)",
          flexShrink: 0,
          cursor: "grab",
          "&:active": { cursor: "grabbing" },
        }}
      />
      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
        <ClipWaveform
          ref={waveformRef}
          segment={segment}
          trackBuffer={trackBuffer}
          pxPerSec={pxPerSec}
        />
        {/* Poignées de resize : limitées au corps du clip (jamais le header,
            réservé au drag). interact.js arme le resize uniquement quand le
            pointeur tombe sur l'une d'elles. */}
        <Box
          data-resize-left
          sx={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: 8,
            cursor: "ew-resize",
            zIndex: 2,
          }}
        />
        <Box
          data-resize-right
          sx={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 0,
            width: 8,
            cursor: "ew-resize",
            zIndex: 2,
          }}
        />
      </Box>
    </Box>
  );
}
