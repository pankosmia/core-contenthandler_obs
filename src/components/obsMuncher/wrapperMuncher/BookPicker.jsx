import React, { useState, useContext, useEffect } from "react";
import { Box, MenuItem, TextField } from "@mui/material";
import { getJson } from "pankosmia-lib/http";
import { doI18n } from "pankosmia-lib/i18n";
import {
  bcvContext as BcvContext,
  i18nContext as I18nContext,
  currentProjectContext as CurrentProjectContext,
  debugContext as DebugContext,
} from "pankosmia-rcl";
function BookPicker({ setFirstChapter, disable = false }) {
  const { bcvRef } = useContext(BcvContext);
  const { debugRef } = useContext(DebugContext);
  const { i18nRef } = useContext(I18nContext);
  const { currentProjectRef } = useContext(CurrentProjectContext);
  const [contentBooks, setContentBooks] = useState([]);
  const [currentBook, setCurrentBook] = useState(bcvRef.current.bookCode);

  useEffect(() => {
    const getProjectBooks = async () => {
      if (currentProjectRef.current) {
        const projectPath = `${currentProjectRef.current.source}/${currentProjectRef.current.organization}/${currentProjectRef.current.project}`;
        const fullMetadataResponse = await getJson(
          `/api/burrito/metadata/summary/${projectPath}`,
          debugRef.current,
        );
        if (fullMetadataResponse.ok) {
          setContentBooks(fullMetadataResponse.json.book_codes);
          setCurrentBook(fullMetadataResponse.json.book_codes[0]);
        } else {
          enqueueSnackbar(
            `${doI18n("pages:core-contenthandler_juxta:error", i18nRef.current)}: ${fullMetadataResponse.status}`,
            { variant: "error" },
          );
        }
      }
    };
    getProjectBooks().then();
  }, [currentProjectRef.current]);

  useEffect(() => {
    if (currentBook && bcvRef.current.bookCode !== currentBook) {
      setFirstChapter(currentProjectRef.current, debugRef.current, currentBook);
    }
  }, [currentBook]);

  return (
    <Box sx={{ justifyContent: "space-between" }}>
      <div>
        <TextField
          disabled={disable}
          label={`${doI18n("pages:core-local-workspace:book", i18nRef.current)}`}
          fullWidth
          id="book-button"
          size="small"
          select
          value={bcvRef.current.bookCode}
        >
          {contentBooks.map((b, n) => (
            <MenuItem
              sx={{ maxHeight: "3rem", height: "2rem" }}
              value={b}
              key={n}
              onClick={() => setCurrentBook(b)}
            >
              {doI18n(`scripture:books:${b}`, i18nRef.current)}
            </MenuItem>
          ))}
        </TextField>
      </div>
    </Box>
  );
}

export default BookPicker;
