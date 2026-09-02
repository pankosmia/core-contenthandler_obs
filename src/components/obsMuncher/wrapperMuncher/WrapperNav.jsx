import { useState, useContext } from "react";
import { BurritoSelect } from "./BurritoSelect";
import BookPicker from "./BookPicker";
import { Box } from "@mui/material";
import { getFirstChapter } from "./findFirstChapter";
import { BcvPicker } from "./BcvPicker";
import ObsNavigation from "./ObsNavigation";
import OBSContext from "../muncher/context/obsContext";

export function WrapperNav({ flavor }) {
  const { obs, setObs } = useContext(OBSContext);
  return (
    <Box
      sx={{ display: "flex", flexDirection: "row", gap: 1, paddingBottom: 5 }}
    >
      <BurritoSelect flavor={flavor} />
      <ObsNavigation obs={obs} setObs={setObs} />
      {/* <BookPicker setFirstChapter={getFirstChapter(flavor)} /> 
      <BcvPicker /> */}
    </Box>
  );
}
