import { useState, useEffect } from "react";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import { DialogContent, DialogContentText, useTheme } from "@mui/material";
import AudioRecorder from "../Editor/EditorTools/AudioRecorder";
import MarkdownField from "../../muncher/MarkdownField";
import "../../muncher/OBSMuncher.css";
import { PanDialog, PanDialogActions } from "pankosmia-rcl";
import { debugContext as DebugContext } from "pankosmia-rcl";
import { getText, postText } from "pankosmia-lib/http";
import md5 from "md5";
import OBSEditorTools from "../Editor/EditorTools/OBSEditorTools";
import FfmpegDownloadButton from "../Editor/EditorTools/FfmpegDownloadButton";
import getFfmpegPath from "../Editor/EditorTools/helpers/getFfmpegPath";
import {
  loadGeneratedAtMap,
  saveGeneratedAt,
} from "../Editor/EditorTools/lib/audioGeneratedAt";

function OBSEditorMuncher({ metadata, debugRef, obs, setObs, i18nRef }) {
  const theme = useTheme();
  const [ingredient, setIngredient] = useState([]);
  const [audioUrl, setAudioUrl] = useState("");
  const [checksums, setChecksums] = useState({});
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [chapterChecksums, setChapterChecksums] = useState([]);
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const isMenuOpen = Boolean(menuAnchorEl);
  const [isExportingParaEnabled, setIsExportingParaEnabled] = useState(false);
  const [generatedAtMap, setGeneratedAtMap] = useState(() =>
    loadGeneratedAtMap(metadata.local_path),
  );
  const [ffmpegModalOpen, setFfmpegModalOpen] = useState(false);
  // One timestamp per paragraph: obs = [story, paragraph].
  const audioSegmentKey = `${obs[0]}:${obs[1]}`;

  /* Données de l'ingredient */
  const initIngredient = async () => {
    if (obs[0] < 0) obs[0] = 0;
    if (obs[0] > 50) obs[0] = 50;
    if (ingredient[obs[0]]) {
      return;
    }
    let fileName = obs[0] <= 9 ? `0${obs[0]}` : obs[0];
    const ingredientLink = `/api/burrito/ingredient/raw/${metadata.local_path}?ipath=content/${fileName}.md`;
    let response = await getText(ingredientLink, debugRef.current);
    if (response.ok) {
      const chapterContent = response.text
        .split(/\n\r?\n\r?/)
        .filter((_, index) => index % 2 === 0); // Lignes paires
      setIngredient((prevIngredient) => {
        const newIngredient = [...prevIngredient];
        newIngredient[obs[0]] = chapterContent;
        return newIngredient;
      });
      for (let i = 0; i < chapterContent.length; i++) {
        initChecksums(obs[0], i, chapterContent[i]);
      }
      const newChapterChecksums = [...chapterChecksums];
      newChapterChecksums[obs[0]] = calculateChapterChecksum(chapterContent);
      setChapterChecksums(newChapterChecksums);
    }
  };
  const handleChange = (event) => {
    setIngredient((prevIngredient) => {
      const newIngredient = [...prevIngredient];
      if (!newIngredient[obs[0]]) {
        newIngredient[obs[0]] = [];
      }
      newIngredient[obs[0]] = [...newIngredient[obs[0]]];
      newIngredient[obs[0]][obs[1]] = event.target.value.replaceAll(/\s/g, " ");
      return newIngredient;
    });
  };

  /* Vérification des sauvegardes */
  const calculateChapterChecksum = (chapter) => {
    if (!chapter) return 0;
    let checksum = 0;
    for (let i = 0; i < chapter.length; i++) {
      checksum += md5(chapter[i]);
    }
    return checksum;
  };

  const initChecksums = (chapterIndex, paragraphIndex, content) => {
    const key = `${chapterIndex}-${paragraphIndex}`;
    const checksum = md5(content);
    setChecksums((prev) => ({ ...prev, [key]: checksum }));
  };

  const isModified = () => isTextModified();

  const isTextModified = () => {
    const chapterIndex = obs[0];
    const originalChecksum = chapterChecksums[chapterIndex];
    if (!originalChecksum) {
      return false;
    }
    const currentChecksum = calculateChapterChecksum(ingredient[chapterIndex]);

    return originalChecksum !== currentChecksum;
  };

  const isAudioModified = async () => {
    const cc = String(obs[0]).padStart(2, "0");
    const pp = String(obs[1]).padStart(2, "0");
    const res = await fetch(`/api/burrito/paths-info/${metadata.local_path}`);
    // if (!res.ok) return false;
    const files = await res.json();
    const projectPath = `audio_content/${cc}-${pp}/${cc}-${pp}_project.json`;
    const mp3Path = `audio_content/${cc}-${pp}/${cc}-${pp}.mp3`;
    const project = files.find((f) => f.path === projectPath);
    const mp3 = files.find((f) => f.path === mp3Path);
    const projectUrl = `/api/burrito/ingredient/raw/${metadata.local_path}?ipath=audio_content/${cc}-${pp}/${cc}-${pp}_project.json`;
    const projectResponse = await fetch(projectUrl);
    const projectData = await projectResponse.json();
    const tracks = projectData.tracks;
    // verifier que les edl sont vides
    const isEdlEmpty = tracks.every((t) => t.edl.length === 0);

    if (!project) return false;

    if (isEdlEmpty) return false;
    if (!mp3) return true;

    console.log(`${cc}-${pp} project.modified_epoch`, project.modified_epoch);
    console.log(`${cc}-${pp} mp3.modified_epoch`, mp3.modified_epoch);
    return project.modified_epoch > mp3.modified_epoch;
  };

  const updateChecksums = (chapterIndex) => {
    const chapter = ingredient[chapterIndex];
    if (!chapter) return;

    setChecksums((prev) => {
      const newChecksums = { ...prev };
      chapter.forEach((content, paragraphIndex) => {
        const key = `${chapterIndex}-${paragraphIndex}`;
        newChecksums[key] = md5(content);
      });
      return newChecksums;
    });

    setChapterChecksums((prev) => {
      const newChapterChecksums = [...prev];
      newChapterChecksums[chapterIndex] = calculateChapterChecksum(chapter);
      return newChapterChecksums;
    });
  };

  /* Systeme de sauvegarde */
  const handleSaveOBS = async () => {
    if (!ingredient || ingredient.length === 0) return;
    for (let i = 0; i < ingredient.length; i++) {
      if (!ingredient[i] || ingredient[i].length === 0) continue;
      await uploadOBSIngredient(ingredient[i], i);
    }
  };

  // Vrai si le projet audio du paragraphe courant n'a pas de piste principale
  // exploitable (EDL vide ou projet absent). Compiler dans ce cas n'assemble
  // rien et le serveur renvoie une 500 peu parlante : on l'intercepte avant.
  // La piste principale est toujours la première du _project.json (cf. ordre
  // de création des pistes dans le hook de persistance).
  const isMainTrackEmpty = async () => {
    const cc = String(obs[0]).padStart(2, "0");
    const pp = String(obs[1]).padStart(2, "0");
    const projectUrl = `/api/burrito/ingredient/raw/${metadata.local_path}?ipath=audio_content/${cc}-${pp}/${cc}-${pp}_project.json`;
    try {
      const res = await fetch(projectUrl);
      if (!res.ok) return true;
      const data = await res.json();
      const mainTrack = data?.tracks?.[0];
      return !mainTrack?.edl || mainTrack.edl.length === 0;
    } catch {
      return true;
    }
  };

  // Lit le corps de la réponse pour produire un message d'erreur parlant
  // (le serveur y détaille l'échec, ex. erreur ffmpeg) au lieu d'un
  // « undefined ». Tronqué pour rester lisible dans le snackbar.
  const describeError = async (response) => {
    const body = await response.text().catch(() => "");
    const detail = (body || response.statusText || "").trim().slice(0, 300);
    return `${response.status}${detail ? ` — ${detail}` : ""}`;
  };

  // Renvoie false quand on court-circuite pour afficher le modal FFmpeg (rien
  // n'a été compilé) afin que l'appelant n'affiche pas de snackbar de succès.
  const compileAudio = async () => {
    /* curl -X POST http://localhost:19119/api/audio/compile/_local_/_local_/OBST \
            -H "Content-Type: application/json" -d '{"chapter":1,"paragraph":3}' */
    // Dans le viewer Electron, si aucun ffmpeg n'est disponible, on propose de
    // le télécharger. Sinon on récupère le chemin du ffmpeg téléchargé et on le
    // transmet aux requêtes de compilation via `ffmpeg_path` (le backend
    // privilégie le ffmpeg système et retombe sur ce chemin à défaut).
    if (window.electronAPI) {
      const isFFmpegInstalled = await window.electronAPI.checkFfmpegInstalled();
      if (!isFFmpegInstalled) {
        setFfmpegModalOpen(true);
        return false;
      }
    }
    if (await isMainTrackEmpty()) {
      throw new Error(
        "Cannot generate audio: the main track is empty. Add audio to the main track before generating.",
      );
    }
    const ffmpegPath = await getFfmpegPath();
    const audioUrl = `/api/audio/compile/${metadata.local_path}`;
    const json = {
      chapter: obs[0],
      paragraph: obs[1],
      ...(ffmpegPath ? { ffmpeg_path: ffmpegPath } : {}),
    };
    const response = await fetch(audioUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to compile audio: ${await describeError(response)}`,
      );
    }

    /*  curl -X POST http://localhost:19119/api/audio/compile-chapter/_local_/_local_/OBST \
            -H "Content-Type: application/json" \
            -d '{"chapter": 1}' */
    const audioChapterUrl = `/api/audio/compile-chapter/${metadata.local_path}`;
    const chapterJson = {
      chapter: obs[0],
      ...(ffmpegPath ? { ffmpeg_path: ffmpegPath } : {}),
    };
    const chapterResponse = await fetch(audioChapterUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chapterJson),
    });
    if (!chapterResponse.ok) {
      throw new Error(
        `Failed to compile audio chapter: ${await describeError(chapterResponse)}`,
      );
    }

    setGeneratedAtMap(
      saveGeneratedAt(metadata.local_path, `${obs[0]}:${obs[1]}`),
    );
    return true;
  };

  const uploadOBSIngredient = async (ingredientItem, i) => {
    let fileName = i <= 9 ? `0${i}` : i;
    const obsString = await getStringifyIngredient(ingredientItem, fileName);
    const payload = JSON.stringify({ payload: obsString });
    const response = await postText(
      `/api/burrito/ingredient/raw/${metadata.local_path}?ipath=content/${fileName}.md`,
      payload,
      debugRef,
      "application/json",
    );
    if (response.ok) {
      updateChecksums(i);
    } else {
      console.error(`Failed to save file ${fileName}`);
      throw new Error(
        `Failed to save file ${fileName}: ${response.status}, ${response.error}`,
      );
    }
  };
  const getOs = () => {
    const os = ["Windows", "Linux", "Mac"];
    return os.find((v) => navigator.userAgent.indexOf(v) >= 0);
  };
  const getStringifyIngredient = async (ingredientItem, fileName) => {
    const response = await getText(
      `/api/burrito/ingredient/raw/${metadata.local_path}?ipath=content/${fileName}.md`,
      debugRef,
    );
    if (response.ok) {
      const returnedText = response.text
        .split(/\n\r?\n\r?/)
        .map((line, index) => {
          if (index % 2 === 1) {
            return line.replaceAll(/\n/g, " ");
          } else {
            return ingredientItem[index / 2];
          }
        });
      // Detecter l'os
      if (getOs() === "Windows") {
        return returnedText.join("\r\n\r\n");
      } else {
        return returnedText.join("\n\n");
      }
    }
  };

  /* Gestion de l'audio */
  function AudioViewer({ chapter, paragraph }) {
    let chapterString = chapter < 10 ? `0${chapter}` : chapter;
    let paragraphString = paragraph < 10 ? `0${paragraph}` : paragraph;
  }

  const currentChapter = ingredient[obs[0]] || [];

  const updateIsExportingParaEnabled = async () => {
    if (obs[1] === 0) {
      console.log("obs[1] === 0");
      setIsExportingParaEnabled(false);
    } else if ((await getMainTrack()) === null) {
      console.log("(await getMainTrack()) === null");
      setIsExportingParaEnabled(false);
    } else {
      console.log("setIsExportingParaEnabled(true)");
      setIsExportingParaEnabled(true);
    }
  };

  useEffect(() => {
    handleSaveOBS();
    initIngredient().then();
  }, [obs[0]]);

  useEffect(() => {
    updateIsExportingParaEnabled();
  }, [obs]);

  // Intercepter les tentatives de navigation
  useEffect(() => {
    const isElectron = !!window.electronAPI;
    if (isElectron) {
      if (isModified()) {
        window.electronAPI.setCanClose(false);
      } else {
        window.electronAPI.setCanClose(true);
      }
    }
  }, [isModified]);

  const chapterTitle = (currentChapter[0] || "").replace(/^#+\s*/, "").trim();

  const getMainTrack = async () => {
    const url = `/api/burrito/paths/${metadata.local_path}`;
    const response = await fetch(url, {
      method: "GET",
    });
    const data = await response.json();
    const cc = String(obs[0]).padStart(2, "0");
    const pp = String(obs[1]).padStart(2, "0");
    const mp3Path = `audio_content/${cc}-${pp}/${cc}-${pp}.mp3`;
    const match = data.find((item) => item.endsWith(mp3Path));
    return match || null;
  };

  const handleExportVideoParagraph = async () => {
    setMenuAnchorEl(null);
    const ffmpegPath = await getFfmpegPath();
    const videoUrl = `/api/video/obs-para/${metadata.local_path}`;
    const json = {
      story_n: obs[0],
      para_n: obs[1],
      audio_path: await getMainTrack(),
      ...(ffmpegPath ? { ffmpeg_path: ffmpegPath } : {}),
    };
    const response = await fetch(videoUrl, {
      method: "POST",
      body: JSON.stringify(json),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    console.log(data);
  };

  const handleExportVideoStory = async () => {
    setMenuAnchorEl(null);

    const ffmpegPath = await getFfmpegPath();
    const videoUrl = `/api/video/obs-story/${metadata.local_path}`;
    const json = {
      story_n: obs[0],
      ...(ffmpegPath ? { ffmpeg_path: ffmpegPath } : {}),
    };
    const response = await fetch(videoUrl, {
      method: "POST",
      body: JSON.stringify(json),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    console.log(data);
  };

  return (
    <>
      <OBSEditorTools
        obs={obs}
        setObs={setObs}
        isModified={isModified}
        handleSaveOBS={handleSaveOBS}
        audioEnabled={audioEnabled}
        setAudioEnabled={setAudioEnabled}
        currentChapter={currentChapter}
        chapterTitle={chapterTitle}
        handleExportVideoParagraph={handleExportVideoParagraph}
        isExportingParaEnabled={isExportingParaEnabled}
        handleExportVideoStory={handleExportVideoStory}
        isMenuOpen={isMenuOpen}
        menuAnchorEl={menuAnchorEl}
        setMenuAnchorEl={setMenuAnchorEl}
        compileAudio={compileAudio}
        generatedAt={generatedAtMap[audioSegmentKey]}
        i18nRef={i18nRef}
        debugRef={debugRef}
      />
      <PanDialog
        titleLabel="FFmpeg not installed"
        isOpen={ffmpegModalOpen}
        closeFn={() => setFfmpegModalOpen(false)}
        theme={theme}
        size="sm"
      >
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            FFmpeg is required to compile audio and is not installed yet.
            Download it below, then generate the audio again.
          </DialogContentText>
          <FfmpegDownloadButton />
        </DialogContent>
        <PanDialogActions
          onlyCloseButton
          closeFn={() => setFfmpegModalOpen(false)}
          closeLabel="Close"
        />
      </PanDialog>
      <Box sx={{ mt: "120px", padding: 2 }}>
        <Stack>
          <MarkdownField
            currentRow={obs[1]}
            onChangeNote={handleChange}
            value={currentChapter[obs[1]] || ""}
            mode="write"
          />
          {audioEnabled && (
            <AudioRecorder
              audioUrl={audioUrl}
              setAudioUrl={setAudioUrl}
              metadata={metadata}
              obs={obs}
              // Nom de la piste principale d'un nouveau projet : story:paragraph,
              // ex. "1:3".
              mainTrackName={`${obs[0]}:${obs[1]}`}
            />
          )}
        </Stack>
      </Box>
    </>
  );
}

export default OBSEditorMuncher;
