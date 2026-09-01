import { Typography } from "@mui/material";
import { doI18n } from "pankosmia-lib/i18n";

// Shows when the audio was last generated, next to the "generate audio" button.
// Never generated: "Audio never generated". Recent (same day): "Generated at:
// 4:35 PM". Older: "Jun 22, 4:35 PM".
function GeneratedAtLabel({ date, i18nRef, debugRef }) {
  const d = date ? (date instanceof Date ? date : new Date(date)) : null;
  const hasDate = d && !isNaN(d.getTime());

  let label;
  if (!hasDate) {
    label = doI18n(
      "pages:core-local-workspace:audio_never_generated",
      i18nRef.current,
      debugRef.current,
    );
  } else {
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    const time = d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });

    if (sameDay) {
      const prefix = doI18n(
        "pages:core-local-workspace:audio_generated_at",
        i18nRef.current,
        debugRef.current,
      );
      label = `${prefix} ${time}`;
    } else {
      const dateStr = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      label = `${dateStr}, ${time}`;
    }
  }

  return (
    <Typography
      variant="caption"
      sx={{ color: "text.secondary", whiteSpace: "nowrap" }}
    >
      {label}
    </Typography>
  );
}

export default GeneratedAtLabel;
