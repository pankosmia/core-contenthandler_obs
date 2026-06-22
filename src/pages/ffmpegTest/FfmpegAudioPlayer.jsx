import { useRef, useState } from "react";
import { Button, Stack, Typography } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

function FfmpegAudioPlayer({ ffmpegInstalled, src }) {
  const audioRef = useRef(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const handlePlay = async () => {
    if (!ffmpegInstalled) return;

    try {
      setErrorMessage(null);
      await audioRef.current?.play();
    } catch (err) {
      setErrorMessage(err.message || "Could not play audio.");
    }
  };

  return (
    <Stack spacing={1} sx={{ maxWidth: 420 }}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <Button
        variant="outlined"
        startIcon={<PlayArrowIcon />}
        onClick={handlePlay}
        disabled={!ffmpegInstalled}
      >
        Play MP3
      </Button>

      {!ffmpegInstalled && (
        <Typography variant="caption" color="text.secondary">
          Install FFmpeg to enable playback.
        </Typography>
      )}

      {errorMessage && (
        <Typography variant="body2" color="error">
          {errorMessage}
        </Typography>
      )}
    </Stack>
  );
}

export default FfmpegAudioPlayer;
