import { useState } from "react";
import { Box } from "@mui/material";
import FfmpegInstaller from "./FfmpegInstaller";
import FfmpegAudioPlayer from "./FfmpegAudioPlayer";

export function FfmpegTestPage() {
  const [ffmpegInstalled, setFfmpegInstalled] = useState(false);

  return (
    <Box sx={{ p: 2 }}>
      <FfmpegInstaller
        ffmpegInstalled={ffmpegInstalled}
        setFfmpegInstalled={setFfmpegInstalled}
      />
      <FfmpegAudioPlayer
        ffmpegInstalled={ffmpegInstalled}
        src={new URL("./MRK_001.mp3", import.meta.url).href}
      />
    </Box>
  );
}
