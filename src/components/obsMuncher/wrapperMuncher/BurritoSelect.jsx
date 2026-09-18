import { MenuItem, Select, FormControl, InputLabel } from "@mui/material";
import { useContext, useEffect, useState } from "react";
import { currentProjectContext } from "pankosmia-rcl";
import { getJson, postEmptyJson } from "pankosmia-lib/http";

export function BurritoSelect({ flavor }) {
  const { currentProjectRef } = useContext(currentProjectContext);
  const [filteredSummary, setFilteredSummary] = useState(null);
  const [currentBurrito, setCurrentBurrito] = useState(null);

  useEffect(() => {
    async function getSummary() {
      let response = await getJson("/api/burrito/metadata/summaries");
      if (!response.ok) {
        enqueueSnackbar(
          `${doI18n("pages:core-contenthandler_juxta:error", i18nRef.current)}: ${response.status}`,
          { variant: "error" },
        );
        return;
      }
      response = response.json;
      response = Object.entries(response).filter(
        ([bName, bInfo]) => bInfo.flavor === flavor,
      );
      setFilteredSummary(response);

      if (!currentProjectRef.current) {
        setCurrentBurrito(response[0]);
      } else {
        const path = `${currentProjectRef.current.source}/${currentProjectRef.current.organization}/${currentProjectRef.current.project}`;

        const selected = response.find(([bName]) => bName === path);

        setCurrentBurrito(selected ?? response[0]);
      }
    }
    getSummary();
  }, [flavor, currentProjectRef.current]);

  async function newBurritoSelected() {
    if (currentBurrito) {
      await postEmptyJson(
        `/api/app-state/current-project/${currentBurrito[0]}`,
      );
    }
  }

  useEffect(() => {
    if (currentBurrito) {
      newBurritoSelected();
    }
  }, [currentBurrito]);

  const handleChange = (event) => {
    const selected = filteredSummary.find(
      ([bName]) => bName === event.target.value,
    );
    setCurrentBurrito(selected);
  };
  useEffect(() => {}, [currentBurrito]);

  return (
    filteredSummary && (
      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id="burrito-select-label">Burrito</InputLabel>
        <Select
          labelId="burrito-select-label"
          label="Burrito"
          value={currentBurrito ? currentBurrito[0] : ""}
          onChange={handleChange}
        >
          {filteredSummary.map(([bName, bInfo]) => (
            <MenuItem key={bName} value={bName}>
              {bName}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    )
  );
}
