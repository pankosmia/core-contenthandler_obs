import { useContext, useState, useCallback, useEffect } from "react";
import { Chip, Grid2 } from "@mui/material";
import { doI18n } from "pithekos-lib";
import { i18nContext} from "pankosmia-rcl";

import { useNavigate } from "react-router-dom";

function App() {
  const [maxWindowHeight, setMaxWindowHeight] = useState(
    window.innerHeight - 64
  );
  const handleWindowResize = useCallback((event) => {
    setMaxWindowHeight(window.innerHeight - 64);
  }, []);
  const { i18nRef } = useContext(i18nContext);
  const navigate = useNavigate();

  useEffect(() => {
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [handleWindowResize]);

  return (
    <Grid2 container spacing={2} sx={{ maxHeight: maxWindowHeight }}>
      <Grid2 size={12}>
        <h1>
          {doI18n(
            "pages:core-contenthandler_obs:stub_content",
            i18nRef.current
          )}
        </h1>
      </Grid2>
      <Chip
        label="bouton create"
        color="secondary"
        variant="outlined"
         onClick={() => navigate("obsContent")}
      />
    </Grid2>
  );
}

export default App;
