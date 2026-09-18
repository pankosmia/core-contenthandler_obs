import { useState, useEffect, useRef } from "react";
import { Button, LinearProgress, Typography, Stack } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckOutlined";
import ErrorIcon from "@mui/icons-material/ErrorOutlined";
import DownloadIcon from "@mui/icons-material/SaveAltOutlined";

// Bouton de téléchargement de FFmpeg, calqué sur AssetDownloadButton des
// settings (asset="ffmpeg") : télécharge le binaire via l'API Electron, affiche
// la progression puis l'état installé/erreur. Sans Electron (navigateur), le
// téléchargement est indisponible et le bouton reste désactivé.
export default function FfmpegDownloadButton({ onInstalled }) {
  // checking | idle | downloading | complete | error | unavailable
  const [status, setStatus] = useState("checking");
  const [progress, setProgress] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const isElectron = typeof window !== "undefined" && !!window.electronAPI;
  // Gardé dans une ref pour ne pas ré-abonner les listeners à chaque render.
  const onInstalledRef = useRef(onInstalled);
  onInstalledRef.current = onInstalled;

  useEffect(() => {
    if (!window.electronAPI) {
      setStatus("unavailable");
      return;
    }
    let cancelled = false;
    window.electronAPI.checkFfmpegInstalled().then((installed) => {
      if (!cancelled) {
        setStatus(installed ? "complete" : "idle");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }
    const removeProgress = window.electronAPI.onFfmpegDownloadProgress(
      (percent) => {
        if (typeof percent === "number" && !Number.isNaN(percent)) {
          setProgress(Math.max(0, Math.min(100, percent)));
        }
      },
    );
    const removeComplete = window.electronAPI.onFfmpegDownloadComplete(
      (success, message) => {
        setStatus(success ? "complete" : "error");
        if (success) {
          setProgress(100);
          setErrorMessage(null);
          onInstalledRef.current?.();
        } else {
          setErrorMessage(message || null);
        }
      },
    );
    return () => {
      removeProgress();
      removeComplete();
    };
  }, []);

  const handleInstall = () => {
    if (!window.electronAPI) {
      return;
    }
    setStatus("downloading");
    setProgress(null);
    setErrorMessage(null);
    window.electronAPI.downloadFfmpeg();
  };

  const hasProgress = typeof progress === "number";

  const label = {
    checking: isElectron ? "Checking…" : "Download unavailable",
    idle: "Download FFmpeg",
    downloading: "Downloading…",
    complete: "FFmpeg installed",
    error: "Retry download",
    unavailable: "Download unavailable",
  }[status];

  return (
    <Stack sx={{ maxWidth: 220 }}>
      <Button
        variant="contained"
        startIcon={
          status === "complete" ? (
            <CheckCircleIcon />
          ) : status === "error" ? (
            <ErrorIcon />
          ) : (
            <DownloadIcon />
          )
        }
        onClick={handleInstall}
        disabled={
          !isElectron ||
          status === "checking" ||
          status === "downloading" ||
          status === "complete"
        }
        color={
          status === "complete"
            ? "success"
            : status === "error"
              ? "error"
              : "primary"
        }
      >
        {label}
      </Button>

      {status === "downloading" && (
        <>
          <LinearProgress
            variant={hasProgress ? "determinate" : "indeterminate"}
            value={hasProgress ? progress : undefined}
          />
          <Typography variant="body2" color="text.secondary">
            {hasProgress ? `${Math.round(progress)}% complete` : "Downloading…"}
          </Typography>
        </>
      )}

      {status === "error" && (
        <Typography variant="body2" color="error">
          Download failed{errorMessage ? `: ${errorMessage}` : ""}.
        </Typography>
      )}
    </Stack>
  );
}
