import { useEffect, useRef, useState } from "react";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import CheckIcon from "@mui/icons-material/CheckOutlined";
import MicIcon from "@mui/icons-material/MicNoneOutlined";
import ExpandMoreIcon from "@mui/icons-material/KeyboardArrowDownOutlined";

// Sélecteur de micro, façon Discord/Zoom : un petit chevron à côté du bouton
// micro ouvre un menu listant les périphériques d'entrée, avec un vumètre live
// pour tester le micro sélectionné avant d'enregistrer. La sélection est
// gérée/persistée par le parent.

// Lit le niveau du flux via un AnalyserNode et anime une barre (0..1).
// Réutilise l'AudioContext du parent pour ne pas en multiplier les instances.
function useMicLevel(audioCtxRef, active, deviceId) {
  const [level, setLevel] = useState(0);
  const streamRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      try {
        sourceRef.current?.disconnect();
      } catch {
        /* déjà déconnecté */
      }
      sourceRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setLevel(0);
    };

    (async () => {
      try {
        const audio =
          deviceId && deviceId !== "default"
            ? { deviceId: { exact: deviceId } }
            : true;
        const stream = await navigator.mediaDevices.getUserMedia({ audio });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        audioCtxRef.current ??= new AudioContext();
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") await ctx.resume();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        streamRef.current = stream;
        sourceRef.current = src;

        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          let max = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = Math.abs(buf[i]);
            if (v > max) max = v;
          }
          // Légère descente pour un rendu plus fluide façon vumètre.
          setLevel((prev) => Math.max(max, prev * 0.85));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        /* permission refusée / device absent : pas de vumètre */
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [active, deviceId, audioCtxRef]);

  return level;
}

export default function MicSourcePicker({
  source,
  onChange,
  audioCtxRef,
  disabled,
}) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [mics, setMics] = useState([]);
  const open = Boolean(anchorEl);

  // Vumètre actif seulement quand le menu est ouvert : on teste le micro ciblé.
  const meterDeviceId = open ? source?.deviceId : null;
  const level = useMicLevel(audioCtxRef, meterDeviceId != null, meterDeviceId);

  // (Ré)énumère les micros à l'ouverture et sur branchement/débranchement.
  // Les labels ne sont remplis qu'après une autorisation micro : en Electron
  // elle est accordée par l'hôte ; le vumètre ci-dessus ouvre de toute façon un
  // flux qui débloque les noms.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setMics(devices.filter((d) => d.kind === "audioinput"));
      } catch {
        /* ignore */
      }
    };
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, [open]);

  const isMicSelected = (deviceId) => source?.deviceId === deviceId;

  const pickMic = (deviceId) => {
    onChange({ mode: "mic", deviceId });
    setAnchorEl(null);
  };

  return (
    <>
      <Tooltip title="Audio input source">
        <span>
          <IconButton
            size="small"
            onClick={(e) => setAnchorEl(e.currentTarget)}
            disabled={disabled}
            sx={{ p: 0, ml: -0.5 }}
          >
            <ExpandMoreIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { minWidth: 260 } } }}
      >
        <ListSubheader>Input device</ListSubheader>
        {[{ deviceId: "default", label: "System default" }]
          .concat(mics.filter((m) => m.deviceId && m.deviceId !== "default"))
          .map((m) => {
            const sel = isMicSelected(m.deviceId);
            return (
              <MenuItem
                key={m.deviceId}
                selected={sel}
                onClick={() => pickMic(m.deviceId)}
              >
                <ListItemIcon>
                  <MicIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primaryTypographyProps={{ noWrap: true }}>
                  {m.label || `Microphone ${m.deviceId.slice(0, 6)}`}
                </ListItemText>
                {sel && <CheckIcon fontSize="small" sx={{ ml: 1 }} />}
              </MenuItem>
            );
          })}

        <ListSubheader>Mic test</ListSubheader>
        <Box sx={{ px: 2, pb: 1 }}>
          <LinearProgress
            variant="determinate"
            value={Math.min(100, level * 140)}
          />
        </Box>
      </Menu>
    </>
  );
}
