import { getJson, postEmptyJson, getText } from "pankosmia-lib/http";
export async function getFirstChapterTextTranslation(
  currentProjectRefCurr,
  debugRefCurr,
  bookCode,
) {
  const projectPath = `${currentProjectRefCurr.source}/${currentProjectRefCurr.organization}/${currentProjectRefCurr.project}`;
  const responce = await getText(
    `/api/burrito/ingredient/raw/${projectPath}?ipath=${bookCode}.usfm`,
  );
  if (responce.ok) {
    const usfmString = responce.text;
    const re = /\\c\s+(\d+)/;
    const match = usfmString.match(re);
    if (match) {
      const chapter = match[1];
      postEmptyJson(
        `/api/navigation/bcv/${bookCode}/${chapter}/1`,
        debugRefCurr,
      );
    }
  }
}

export async function getFirstChapterJuxta(
  currentProjectRefCurr,
  debugRefCurr,
  bookCode,
) {
  const projectPath = `${currentProjectRefCurr.source}/${currentProjectRefCurr.organization}/${currentProjectRefCurr.project}`;
  const responce = await getJson(
    `/api/burrito/ingredient/raw/${projectPath}?ipath=${bookCode}.json`,
    debugRefCurr,
  );
  if (responce.ok) {
    let [chapter, verse] = responce.json[0].chunks[0].source[0].cv.split(":");
    let responsePost = await postEmptyJson(
      `/api/navigation/bcv/${bookCode}/${chapter}/${verse}`,
      debugRefCurr,
    );
    if (!responsePost.ok) {
      enqueueSnackbar(
        `${doI18n("pages:core-contenthandler_juxta:error", i18nRef.current)}: ${responsePost.status}`,
        { variant: "error" },
      );
    }
  } else {
    enqueueSnackbar(
      `${doI18n("pages:core-contenthandler_juxta:error", i18nRef.current)}: ${response.status}`,
      { variant: "error" },
    );
  }
}

export async function getFirstChapterBCVNotes(
  currentProjectRefCurr,
  debugRefCurr,
  bookCode,
) {
  const projectPath = `${currentProjectRefCurr.source}/${currentProjectRefCurr.organization}/${currentProjectRefCurr.project}`;
  const responce = await getText(
    `/api/burrito/ingredient/raw/${projectPath}?ipath=${bookCode}.tsv`,
    debugRefCurr,
  );
  if (responce.ok) {
    const firstCol = responce.text
      .split("\n")
      .map((line) => line.split("\t")[0].trim()) // first column
      .filter((v) => /^\d+:\d+$/.test(v)) // only chapter:verse
      .map((v) => {
        const [c, vrs] = v.split(":").map(Number);
        return { raw: v, chapter: c, verse: vrs };
      });

    if (firstCol.length > 0) {
      const { chapter, verse } = firstCol[0]; // get the first valid chapter:verse
      postEmptyJson(
        `/api/navigation/bcv/${bookCode}/${chapter}/${verse}`,
        debugRefCurr,
      );
    }
  }
}

export function getFirstChapter(flavor) {
  switch (flavor) {
    case "x-juxtalinear":
      return getFirstChapterJuxta;
    default:
      return getFirstChapterTextTranslation;
  }
}
