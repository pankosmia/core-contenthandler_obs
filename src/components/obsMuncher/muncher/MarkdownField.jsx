import { useState, useContext } from "react";
import Markdown from "react-markdown";
import RemoveRedEyeIcon from "@mui/icons-material/RemoveRedEye";
import CreateIcon from "@mui/icons-material/Create";
import {
  Box,
  ToggleButton,
  ToggleButtonGroup,
  FormControl,
  TextField,
} from "@mui/material";
import { i18nContext as I18nContext } from "pankosmia-rcl";
import { doI18n } from "pankosmia-lib/i18n";

function MarkdownField({
  onChangeNote,
  value,
  ingredient,
  currentRowN,
  mode,
  label,
}) {
  const { i18nRef } = useContext(I18nContext);
  const [displayMode, setdisplayMode] = useState("write");

  return (
    <Box>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={displayMode}
        onChange={(event, newDisplayMode) => {
          if (newDisplayMode !== null) {
            setdisplayMode(newDisplayMode);
          }
        }}
      >
        <ToggleButton value="write">
          <CreateIcon />
        </ToggleButton>
        <ToggleButton value="preview">
          <RemoveRedEyeIcon />
        </ToggleButton>
      </ToggleButtonGroup>

      {displayMode === "write" ? (
        <FormControl fullWidth margin="normal">
          <TextField
            label={
              doI18n(
                `pages:core-local-workspace:${label.toLowerCase()}`,
                i18nRef.current,
              ) ||
              doI18n(
                `pages:core-local-workspace:text_paragraph`,
                i18nRef.current,
              )
            }
            value={value}
            onChange={onChangeNote}
            minRows={5}
            maxRows={5}
            fullWidth
            multiline
            size="small"
            variant="outlined"
            disabled={
              mode === "edit" &&
              ingredient[currentRowN] &&
              ingredient[currentRowN].length === 1
            }
          />
        </FormControl>
      ) : (
        <Box sx={{ border: "1px solid", marginTop: 2 }}>
          <Markdown fullWidth>{value}</Markdown>
        </Box>
      )}
    </Box>
  );
}

export default MarkdownField;
