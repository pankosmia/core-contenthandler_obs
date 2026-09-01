import { getAndSetJson } from "pankosmia-lib/http";
import { doI18n } from "pankosmia-lib/i18n";
import { i18nContext } from "pankosmia-rcl";
import { useContext, useEffect, useState } from "react";
import { Stack, Typography } from "@mui/material";

export default function RequireResources({
  contentSpec,
  languages = [],
  children,
}) {
  const [resources, setResources] = useState([]);
  const { i18nRef } = useContext(i18nContext);

  useEffect(() => {
    getAndSetJson({
      url: "/api/git/list-local-repos",
      setter: setResources,
    });
  }, []);

  let missingResources = [];
  for (const [roleCode, langSpecs] of Object.entries(contentSpec.general)) {
    const specLangs = [...Object.keys(langSpecs)];
    if (
      specLangs.includes("_all") &&
      resources.includes(langSpecs["_all"]["dcs"]["repoPath"])
    ) {
      continue;
    }
    let found = false;
    if (languages) {
      for (const uiLang of languages) {
        if (
          specLangs.includes(uiLang) &&
          resources.includes(langSpecs[uiLang]["dcs"]["repoPath"])
        ) {
          found = true;
          break;
        }
      }
    }
    if (!found) {
      missingResources.push(roleCode);
    }
  }
  if (missingResources.length > 0) {
    return (
      <Stack>
        <Typography variant="h6">
          {"- "}
          {doI18n(
            "components:require_resources:missing_resources",
            i18nRef.current,
          )}
        </Typography>
        {missingResources
          .map((mr) =>
            Object.entries(contentSpec.general[mr])
              .map((mrlkv) =>
                mrlkv[0] === "_all" || languages.includes(mrlkv[0])
                  ? `${mrlkv[1].dcs.name} (${mrlkv[1].dcs.repoPath})`
                  : mr,
              )
              .join(" --- "),
          )
          .map((mrt) => (
            <Typography variant="body2">{mrt}</Typography>
          ))}
      </Stack>
    );
  }

  return <>{children}</>;
}
