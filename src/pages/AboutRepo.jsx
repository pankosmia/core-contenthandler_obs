import { Box, DialogContent, DialogContentText } from '@mui/material';
import { doI18n, getJson } from 'pithekos-lib';
import { PanDialog, PanDialogActions, i18nContext, debugContext, Header } from "pankosmia-rcl";

import { useContext, useEffect, useState } from 'react';

export default function AboutRepo() {
    const { i18nRef } = useContext(i18nContext);
    const [open, setOpen] = useState(true);
    const hash = window.location.hash;
    const query = hash.includes('?') ? hash.split('?') : '';
    const repoPathQuery = new URLSearchParams(query[1]);
     const typePageQuery = new URLSearchParams(query[2]);
    const returnType = typePageQuery.get("returnTypePage");
    const path = repoPathQuery.get('repoPath');
    const [repoData, setRepodata] = useState({});
    const [repoInfo, setRepoInfo] = useState();
    const getProjectSummaries = async () => {
        const summariesResponse = await getJson(`/burrito/metadata/summary/${path}`, debugContext.current);
        if (summariesResponse.ok) {
            const data = await summariesResponse.json;
            setRepodata({ ...data, path });
        } else {
            console.error(`${doI18n("pages:core-contenthandler_obs:error_data", i18nRef.current)}`);
        }
    };

    useEffect(
        () => {
            getProjectSummaries();
        },
        []
    );
   
    const handleClose = () => {
        setOpen(false);
        if (returnType === "dashboard") {
            setTimeout(() => {
                window.location.href = '/clients/main';
            });
        } else {
            setTimeout(() => {
                window.location.href = '/clients/content';
            });
        }
    };

    useEffect(() => {
        if (repoData) {
            const info = {
                ...repoData,
                nBooks: repoData.book_codes?.length ?? 0,
                source: repoData.path?.startsWith("_local_")
                    ? repoData.path?.startsWith("_local_/_sideloaded_")
                        ? "pages:content:local_resource"
                        : "pages:content:local_project"
                    : null,
            };
            setRepoInfo(info);
        }
    }, [repoData,i18nRef]);

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
                    backdropFilter: "blur(3px)",
                }}
            />
            <Header
                titleKey={returnType === "dashboard" ? "pages:core-dashboard:title" : "pages:content:title"}
                currentId="core-contenthandler_obs"
                requireNet={false}
            />
            <PanDialog
                titleLabel={`${doI18n('pages:content:about_document', i18nRef.current)} ${repoInfo ? `${repoInfo.source ? doI18n(repoInfo.source,i18nRef.current) : `${repoInfo.path?.split("/")[1]} (${repoInfo.path?.split("/")[0]})`}  - ${repoInfo.name}` : repoData.name}`}
                isOpen={open}
                closeFn={() => handleClose()}
            >
                <DialogContent>
                    {repoInfo
                        ? Object.entries(repoInfo).map(([key, value]) => {
                            const keys =
                                repoInfo.name === repoInfo.description
                                    ? ['name', 'flavor', 'generated_date', 'language_code','language_name', 'book_codes']
                                    : ['name', 'description', 'flavor', 'generated_date', 'language_code','language_name', 'book_codes'];
                            if (!keys.includes(key)) return null;
                            return (
                                <DialogContentText
                                    variant={key === 'name' ? 'h6' : 'body2'}
                                    key={key}
                                    sx={{
                                        fontWeight: key === 'name' ? 'bold' : 'normal',
                                        fontStyle: key === 'description' ? 'italic' : 'normal',
                                        mb: 1,
                                    }}
                                >
                                    {key === 'flavor'
                                        ? `${doI18n('pages:content:about_repo_flavor', i18nRef.current)} : ${value}`
                                        : null}
                                    {key === 'language_code'
                                        ? `${doI18n('pages:content:about_repo_language-code', i18nRef.current)} : ${value}`
                                        : null}
                                    {key === 'language_name'
                                        ? `${doI18n('pages:content:about_repo_language-name', i18nRef.current)} : ${value}`
                                        : null}
                                    {key === 'generated_date'
                                        ? `${doI18n('pages:content:about_repo_dateUdapted', i18nRef.current)} : ${value}`
                                        : null}
                                    {key === 'book_codes' && Array.isArray(value)
                                        ? `${doI18n('pages:content:book_or_books', i18nRef.current)} : ${value.join(', ')}`
                                        : null}
                                    {key === 'name' ? `${value}` : null}
                                    {key === 'description' ? `${value}` : null}
                                </DialogContentText>
                            );
                        })
                    : null}
                </DialogContent>
                <PanDialogActions
                    closeFn={() => handleClose()}
                    closeLabel={doI18n('pages:content:close', i18nRef.current)}
                    onlyCloseButton={true}
                />
            </PanDialog>
        </Box>
    );
}
