import { useContext, useState, useCallback, useEffect } from "react";
import { Grid } from "@mui/material";
import { doI18n } from "pankosmia-lib/i18n";
import { i18nContext } from "pankosmia-rcl";

function App() {
  const [maxWindowHeight, setMaxWindowHeight] = useState(
    window.innerHeight - 64,
  );
  const handleWindowResize = useCallback((event) => {
    setMaxWindowHeight(window.innerHeight - 64);
  }, []);
  const { i18nRef } = useContext(i18nContext);

  useEffect(() => {
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [handleWindowResize]);

  return (
    <Grid container spacing={2} sx={{ maxHeight: maxWindowHeight }}>
      <Grid size={12}>
        <h1>
          {doI18n(
            "pages:core-contenthandler_obs:stub_content",
            i18nRef.current,
          )}
        </h1>
      </Grid>
    </Grid>
  );
}

export default App;
