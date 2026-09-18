// the "Jun 22, 4:35 PM" date format).

const keyFor = (localPath) => `audio_generated_at:${localPath}`;

export function loadGeneratedAtMap(localPath) {
  if (!localPath) return {};
  try {
    const stored = localStorage.getItem(keyFor(localPath));
    const parsed = stored ? JSON.parse(stored) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveGeneratedAt(localPath, segmentKey, date = new Date()) {
  const map = loadGeneratedAtMap(localPath);
  if (!segmentKey) return map;
  map[segmentKey] = date.toISOString();
  if (localPath) {
    try {
      localStorage.setItem(keyFor(localPath), JSON.stringify(map));
    } catch {
      // ignore error bcs in memory value still shows.
    }
  }
  return map;
}
