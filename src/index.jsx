import { createRoot } from "react-dom/client";
import { SpaContainer } from "pankosmia-rcl";
import { createHashRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import NewOBSContent from "./pages/NewOBSContent";
import { MaterialDesignContent, SnackbarProvider } from "notistack";
import { styled } from "@mui/material";
import { useState } from "react";
import { MuncherTest } from "./pages/MuncherTest";
import OBSContext from "../src/components/obsMuncher/muncher/context/obsContext";
const router = createHashRouter([
  {
    path: "/",
    element: <MuncherTest />,
  },
  {
    path: "/createDocument/obsContent",
    element: <NewOBSContent />,
  },
]);
function AppLayout() {
  const [obs, setObs] = useState([1, 0]);

  const CustomSnackbarContent = styled(MaterialDesignContent)(() => ({
    "&.notistack-MuiContent-error": {
      backgroundColor: "#FDEDED",
      color: "#D32F2F",
    },
    "&.notistack-MuiContent-info": {
      backgroundColor: "#E5F6FD",
      color: "#0288D1",
    },
    "&.notistack-MuiContent-warning": {
      backgroundColor: "#FFF4E5",
      color: "#EF6C00",
    },
    "&.notistack-MuiContent-success": {
      backgroundColor: "#EDF7ED",
      color: "#2E7D32",
    },
  }));

  return (
    <OBSContext.Provider value={{ obs, setObs }}>
      <SnackbarProvider
        Components={{
          error: CustomSnackbarContent,
          info: CustomSnackbarContent,
          warning: CustomSnackbarContent,
          success: CustomSnackbarContent,
        }}
        maxSnack={6}
      />
      <SpaContainer>
        <RouterProvider router={router} />
      </SpaContainer>
    </OBSContext.Provider>
  );
}
createRoot(document.getElementById("root")).render(<AppLayout />);
