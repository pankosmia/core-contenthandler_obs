import { Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";
import { i18nContext } from "pankosmia-rcl";
import { doI18n } from "pithekos-lib";

import { useContext } from "react";

export default function ErrorDialog({ setErrorDialogOpen, handleClose, errorDialogOpen, errorMessage }) {
    const { i18nRef } = useContext(i18nContext);
    
    const handleCloseErrorDialog = () => {
        setErrorDialogOpen(false);
        handleClose();
    };

    return (
        <Dialog open={errorDialogOpen} onClose={handleCloseErrorDialog}>
            <DialogContent>
                <Typography color="error">{errorMessage}</Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleCloseErrorDialog} variant="contained" color="primary">
                    {doI18n("pages:core-contenthandler_bcv:close", i18nRef.current)}
                </Button>
            </DialogActions>
        </Dialog>
    );
}