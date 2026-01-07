import { useState, useContext, useEffect } from "react";
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    Grid2,
    TextField,
    Typography,
    Tooltip,
    DialogContentText
} from "@mui/material";
import { enqueueSnackbar } from "notistack";
import {
    i18nContext,
    debugContext,
    postJson,
    getAndSetJson,
    doI18n,
    Header,
} from "pithekos-lib";
import { PanDialog, PanDialogActions } from "pankosmia-rcl";

export default function NewOBSContent() {

    const { i18nRef } = useContext(i18nContext);
    const { debugRef } = useContext(debugContext);
    const [contentName, setContentName] = useState("");
    const [contentAbbr, setContentAbbr] = useState("");
    const [contentType, setContentType] = useState("textStories");
    const [contentLanguageCode, setContentLanguageCode] = useState("und");
    const [open, setOpen] = useState(true);
    const [postCount, setPostCount] = useState(0);
    const [errorDialogOpen, setErrorDialogOpen] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [localRepos, setLocalRepos] = useState([]);
    const [repoExists, setRepoExists] = useState(false);

    useEffect(
        () => {
            if (open) {
                getAndSetJson({
                    url: "/git/list-local-repos",
                    setter: setLocalRepos
                }).then()
            }
        },
        [open]
    );

    useEffect(() => {
        setContentName("");
        setContentAbbr("");
        setContentLanguageCode("und");
    }, [postCount]);

    const handleClose = () => {
        const url = window.location.search;
        const params = new URLSearchParams(url);
        const returnType = params.get("returntypepage");
        if (returnType === "dashboard") {
            window.location.href = "/clients/main";
        } else {
            window.location.href = "/clients/content";
        }
    };

    const handleCloseCreate = async () => {
        setOpen(false);
        setTimeout(() => {
            window.location.href = '/clients/content';
        });
    };
    const handleCreate = async () => {
        const payload = {
            content_name: contentName,
            content_abbr: contentAbbr,
            content_language_code: contentLanguageCode,
        };
        const response = await postJson(
            "/git/new-obs-resource",
            JSON.stringify(payload),
            debugRef.current
        );
        if (response.ok) {
            setPostCount(postCount + 1);
            enqueueSnackbar(
                doI18n("pages:core-contenthandler_obs:content_created", i18nRef.current),
                { variant: "success" }
            );
            handleCloseCreate();
        } else {
            setErrorMessage(`${doI18n("pages:core-contenthandler_obs:book_creation_error", i18nRef.current)}: ${response.status
                }`);
            setErrorDialogOpen(true);
        }
    };

    const handleCloseErrorDialog = () => {
        setErrorDialogOpen(false);
        handleClose();
    };

    console.log(repoExists);
    console.log(localRepos);

    return (
        <Box>
            <Box
                sx={{
                    position: "absolute",
                    width: "100%",
                    height: "100%",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    zIndex: -1,
                    backgroundImage:
                        'url("/app-resources/pages/content/background_blur.png")',
                    backgroundRepeat: "no-repeat",
                }}
            />
            <Header
                titleKey="pages:content:title"
                currentId="content"
                requireNet={false}
            />

            <PanDialog
                titleLabel={doI18n("pages:core-contenthandler_obs:create_content_obs", i18nRef.current)}
                isOpen={open}
                closeFn={() => handleClose()}
            >
                <DialogContentText variant="subtitle2" sx={{ ml: 1, p: 1 }}>
                    {doI18n(`pages:core-contenthandler_obs:required_field`, i18nRef.current)}
                </DialogContentText>
                <DialogContent spacing={2}>
                    <Grid2
                        container
                        spacing={2}
                        justifyItems="flex-end"
                        alignItems="stretch"
                        flexDirection={"column"}
                    >
                        <TextField
                            id="name"
                            required
                            label={doI18n("pages:core-contenthandler_obs:name", i18nRef.current)}
                            value={contentName}
                            onChange={(event) => {
                                setContentName(event.target.value);
                            }}
                        />
                        <Tooltip
                            open={repoExists}
                            slotProps={{ popper: { modifiers: [{ name: 'offset', options: { offset: [0, -7] } }] } }}
                            title={doI18n("pages:core-contenthandler_obs:name_is_taken", i18nRef.current)} placement="top-start"
                        >
                            <TextField
                                id="abbr"
                                required
                                label={doI18n("pages:core-contenthandler_obs:abbreviation", i18nRef.current)}
                                value={contentAbbr}
                                onChange={(event) => {
                                    if (localRepos.map(l => l.split("/")[2]).includes(event.target.value)) {
                                        setRepoExists(true);
                                    } else {
                                        setRepoExists(false);
                                    }
                                    setContentAbbr(event.target.value);
                                }}
                            />
                        </Tooltip>
                        <TextField
                            id="type"
                            required
                            disabled={true}
                            sx={{ display: "none" }}
                            label={doI18n("pages:core-contenthandler_obs:type", i18nRef.current)}
                            value={contentType}
                            onChange={(event) => {
                                setContentType(event.target.value);
                            }}
                        />
                        <TextField
                            id="languageCode"
                            required
                            label={doI18n("pages:core-contenthandler_obs:lang_code", i18nRef.current)}
                            value={contentLanguageCode}
                            onChange={(event) => {
                                setContentLanguageCode(event.target.value);
                            }}
                        />
                        
                    </Grid2>
                </DialogContent>
                <PanDialogActions
                    closeFn={() => handleClose()}
                    closeLabel={doI18n("pages:core-contenthandler_obs:close", i18nRef.current)}
                    actionFn={handleCreate}
                    actionLabel={doI18n("pages:core-contenthandler_obs:create", i18nRef.current)}
                    isDisabled={
                        !(
                            contentName.trim().length > 0 &&
                            contentAbbr.trim().length > 0 &&
                            contentType.trim().length > 0 &&
                            contentLanguageCode.trim().length > 0
                        )
                        ||
                        repoExists
                    }
                />
            </PanDialog>
            {/* Error Dialog*/}
            
            <Dialog open={errorDialogOpen} onClose={handleCloseErrorDialog}>
                <DialogContent>
                    <Typography color="error">{errorMessage}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseErrorDialog} variant="contained" color="primary">
                        {doI18n("pages:core-contenthandler_obs:close", i18nRef.current)}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
