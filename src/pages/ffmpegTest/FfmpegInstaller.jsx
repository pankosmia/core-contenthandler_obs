import { useState, useEffect } from "react";
import { Button, LinearProgress, Typography, Stack } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";

function FfmpegInstaller({ ffmpegInstalled, setFfmpegInstalled }) {
  const [status, setStatus] = useState("checking"); // checking | idle | downloading | complete | error
  const [progress, setProgress] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;

    window.electronAPI.checkFfmpegInstalled().then((installed) => {
      if (!cancelled) {
        setFfmpegInstalled(installed);
        setStatus(installed ? "complete" : "idle");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [setFfmpegInstalled]);

  useEffect(() => {
    const removeProgress = window.electronAPI.onFfmpegDownloadProgress(
      (percent) => {
        if (typeof percent === "number" && !Number.isNaN(percent)) {
          setProgress(Math.max(0, Math.min(100, percent)));
        }
      },
    );

    const removeComplete = window.electronAPI.onFfmpegDownloadComplete(
      (success, errorMessage) => {
        setStatus(success ? "complete" : "error");
        setFfmpegInstalled(!!success);

        if (success) {
          setProgress(100);
          setErrorMessage(null);
        } else {
          setErrorMessage(errorMessage || null);
        }
      },
    );

    return () => {
      removeProgress();
      removeComplete();
    };
  }, [setFfmpegInstalled]);

  const handleInstall = () => {
    setStatus("downloading");
    setProgress(null);
    setErrorMessage(null);
    window.electronAPI.downloadFfmpeg();
  };

  const hasProgress = typeof progress === "number";

  return (
    <Stack spacing={2} sx={{ maxWidth: 400 }}>
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
        {status === "checking" && "Checking…"}
        {status === "idle" && "Download FFmpeg"}
        {status === "downloading" && "Downloading…"}
        {status === "complete" && "Installed"}
        {status === "error" && "Retry Download"}
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

export default FfmpegInstaller;
