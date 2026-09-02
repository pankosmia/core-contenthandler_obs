import { Box } from "@mui/material";
import {
  currentProjectContext,
  bcvContext,
  debugContext,
  i18nContext,
} from "pankosmia-rcl";
import { useContext, useState, useEffect } from "react";
import { getJson } from "pankosmia-lib/http";
import OBSViewerMuncher from "../components/obsMuncher/muncher/Viewer/OBSViewerMuncher";
import OBSEditorMuncher from "../components/obsMuncher/muncher/Editor/OBSEditorMuncher";
import { WrapperNav } from "../components/obsMuncher/wrapperMuncher/WrapperNav";
import OBSContext from "../components/obsMuncher/muncher/context/obsContext";
import { Padding } from "@mui/icons-material";
export function MuncherTest() {
  const { bcvRef } = useContext(bcvContext);
  const { currentProjectRef } = useContext(currentProjectContext);
  const { debugRef } = useContext(debugContext);
  const { i18nRef } = useContext(i18nContext);
  const [obs, setObs] = useState([1, 0]);

  const [currentBurrito, setCurrentBurrito] = useState(null);
  const [modified, setModified] = useState(false);

  useEffect(() => {
    async function getSummary() {
      if (currentProjectRef.current) {
        const projectPath = `${currentProjectRef.current.source}/${currentProjectRef.current.organization}/${currentProjectRef.current.project}`;
        const fullMetadataResponse = await getJson(
          `/api/burrito/metadata/summary/${projectPath}`,
        );
        if (fullMetadataResponse.ok) {
          const entry = fullMetadataResponse.json;
          setCurrentBurrito([projectPath, entry]);
        } else {
          enqueueSnackbar(
            `${doI18n("pages:core-contenthandler_juxta:error", i18nRef.current)}: ${fullMetadataResponse.status}`,
            { variant: "error" },
          );
        }
      }
    }

    getSummary();
  }, [currentProjectRef.current]);

  const metadata = currentBurrito && {
    local_path: currentBurrito[0],
    ...currentBurrito[1],
  };

  return (
    <OBSContext.Provider value={{ obs, setObs }}>
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          margin: 3,
          height: "98vh",
        }}
      >
        <WrapperNav flavor={"textStories"} />

        <Box
          sx={{
            display: "flex",
            width: "100%",
            overflowY: "scroll",
            paddingTop: 5,
          }}
        >
          {metadata && (
            <Box sx={{ flex: 1, margin: 2 }}>
              <OBSViewerMuncher
                metadata={metadata}
                bcvRef={bcvRef}
                debugRef={debugRef}
                i18nRef={i18nRef}
              />
            </Box>
          )}

          {metadata && (
            <Box sx={{ flex: 1, margin: 5 }}>
              <OBSEditorMuncher
                metadata={metadata}
                debugRef={debugRef}
                i18nRef={i18nRef}
              />
            </Box>
          )}
        </Box>
      </Box>
    </OBSContext.Provider>
  );
}
