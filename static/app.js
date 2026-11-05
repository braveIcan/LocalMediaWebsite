const state = {
  configured: false,
  rootDirs: [],
  categories: [],
  allItems: [],
  playlist: [],
  playlistTitle: "当前播放列表",
  currentIndex: -1,
  mode: "single",
  sleepTimerId: null,
  sleepDeadline: null,
  sleepStopAfterTrack: false,
};

const configForm = document.getElementById("config-form");
const rootDirInput = document.getElementById("root-dir-input");
const configStatus = document.getElementById("config-status");
const openSettingsButton = document.getElementById("open-settings-button");
const closeSettingsButton = document.getElementById("close-settings-button");
const settingsModal = document.getElementById("settings-modal");
const settingsBackdrop = document.getElementById("settings-backdrop");
const sleepModal = document.getElementById("sleep-modal");
const sleepBackdrop = document.getElementById("sleep-backdrop");
const sleepForm = document.getElementById("sleep-form");
const sleepDurationInput = document.getElementById("sleep-duration-input");
const sleepStatus = document.getElementById("sleep-status");
const sleepTimerButton = document.getElementById("sleep-timer-button");
const closeSleepButton = document.getElementById("close-sleep-button");
const cancelSleepButton = document.getElementById("cancel-sleep-button");
const scanPathEmpty = document.getElementById("scan-path-empty");
const scanPathList = document.getElementById("scan-path-list");
const treeEmpty = document.getElementById("tree-empty");
const treeRoot = document.getElementById("tree-root");
const playAllButton = document.getElementById("play-all-button");
const audioPlayer = document.getElementById("audio-player");
const videoPlayer = document.getElementById("video-player");
const nowTitle = document.getElementById("now-title");
const nowMeta = document.getElementById("now-meta");
const playToggleButton = document.getElementById("play-toggle-button");
const prevButton = document.getElementById("prev-button");
const nextButton = document.getElementById("next-button");
const playlistTitle = document.getElementById("playlist-title");
const playlistMeta = document.getElementById("playlist-meta");
const playlistEmpty = document.getElementById("playlist-empty");
const playlistList = document.getElementById("playlist-list");
const categoryTemplate = document.getElementById("category-template");
const fileTemplate = document.getElementById("file-template");
const playlistItemTemplate = document.getElementById("playlist-item-template");
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
const sleepModeInputs = Array.from(document.querySelectorAll("[name=\"sleep-stop-mode\"]"));

function setStatus(text, mode = "idle") {
  configStatus.textContent = text;
  configStatus.classList.remove("is-error", "is-busy");
  if (mode === "error") {
    configStatus.classList.add("is-error");
  }
  if (mode === "busy") {
    configStatus.classList.add("is-busy");
  }
}

function activePlayer() {
  return !audioPlayer.hidden ? audioPlayer : !videoPlayer.hidden ? videoPlayer : null;
}

function stopPlayers() {
  audioPlayer.pause();
  videoPlayer.pause();
}

function showIdlePlayer() {
  stopPlayers();
  audioPlayer.hidden = true;
  videoPlayer.hidden = true;
  audioPlayer.removeAttribute("src");
  videoPlayer.removeAttribute("src");
}

function syncPlayToggleLabel() {
  const player = activePlayer();
  if (!player || player.paused) {
    playToggleButton.textContent = "播放";
  } else {
    playToggleButton.textContent = "暂停";
  }
}

function stopPlayback() {
  const player = activePlayer();
  if (player) {
    player.pause();
  }
  syncPlayToggleLabel();
}

function renderSleepTimer() {
  const timerActive = state.sleepTimerId !== null || state.sleepStopAfterTrack;
  sleepTimerButton.classList.toggle("is-active", timerActive);
  cancelSleepButton.hidden = !timerActive;

  if (state.sleepStopAfterTrack) {
    sleepStatus.textContent = "计时已结束，将在当前曲目播放完毕后停止。";
    sleepTimerButton.title = "将在当前曲目结束后停止";
    return;
  }

  if (state.sleepDeadline !== null) {
    const minutes = Math.max(1, Math.ceil((state.sleepDeadline - Date.now()) / 60000));
    sleepStatus.textContent = `已设置约 ${minutes} 分钟后停止播放。`;
    sleepTimerButton.title = "已设置定时停止";
    return;
  }

  sleepStatus.textContent = "未设置定时停止。";
  sleepTimerButton.title = "设置定时停止";
}

function clearSleepTimer() {
  if (state.sleepTimerId !== null) {
    window.clearTimeout(state.sleepTimerId);
  }
  state.sleepTimerId = null;
  state.sleepDeadline = null;
  state.sleepStopAfterTrack = false;
  renderSleepTimer();
}

function completeSleepTimer(stopMode) {
  state.sleepTimerId = null;
  state.sleepDeadline = null;

  if (stopMode === "after-track" && activePlayer()) {
    state.sleepStopAfterTrack = true;
  } else {
    state.sleepStopAfterTrack = false;
    stopPlayback();
  }
  renderSleepTimer();
}

function scheduleSleepTimer(minutes, stopMode) {
  clearSleepTimer();
  state.sleepDeadline = Date.now() + minutes * 60 * 1000;
  state.sleepTimerId = window.setTimeout(() => {
    completeSleepTimer(stopMode);
  }, minutes * 60 * 1000);
  renderSleepTimer();
}

function renderConfig() {
  rootDirInput.value = "";
  scanPathList.innerHTML = "";

  if (state.rootDirs.length === 0) {
    scanPathEmpty.hidden = false;
    scanPathList.hidden = true;
    return;
  }

  scanPathEmpty.hidden = true;
  scanPathList.hidden = false;
  const fragment = document.createDocumentFragment();
  state.rootDirs.forEach((rootDir) => {
    const item = document.createElement("div");
    item.className = "scan-path-item";

    const path = document.createElement("span");
    path.className = "scan-path-name";
    path.textContent = rootDir;

    const removeButton = document.createElement("button");
    removeButton.className = "scan-path-remove";
    removeButton.type = "button";
    removeButton.textContent = "−";
    removeButton.setAttribute("aria-label", `移除扫描路径 ${rootDir}`);
    removeButton.title = "移除扫描路径";
    removeButton.addEventListener("click", () => {
      void saveRootDirs(state.rootDirs.filter((path) => path !== rootDir));
    });

    item.append(path, removeButton);
    fragment.append(item);
  });
  scanPathList.append(fragment);
}

function renderTree() {
  treeRoot.innerHTML = "";
  if (!state.configured || state.categories.length === 0) {
    treeEmpty.hidden = false;
    treeRoot.hidden = true;
    return;
  }

  treeEmpty.hidden = true;
  treeRoot.hidden = false;
  const fragment = document.createDocumentFragment();

  state.categories.forEach((category) => {
    const node = categoryTemplate.content.cloneNode(true);
    const block = node.querySelector(".category-block");
    const toggle = node.querySelector(".category-toggle");
    const filesContainer = node.querySelector(".category-files");

    toggle.textContent = `${category.name} · ${category.items.length}`;
    toggle.addEventListener("click", () => {
      block.classList.toggle("is-open");
    });

    category.items.forEach((item) => {
      const fileNode = fileTemplate.content.cloneNode(true);
      const addButton = fileNode.querySelector(".file-add");
      const playButton = fileNode.querySelector(".file-play");
      playButton.textContent = item.title;
      addButton.addEventListener("click", () => {
        addToPlaylist(item);
      });
      playButton.addEventListener("click", () => {
        const startIndex = category.items.findIndex((current) => current.id === item.id);
        setMode("single");
        activatePlaylist(category.items, `${category.name} 播放列表`, startIndex, true);
      });
      filesContainer.append(fileNode);
    });

    block.classList.add("is-open");
    fragment.append(node);
  });

  treeRoot.append(fragment);
}

function renderPlaylist() {
  playlistList.innerHTML = "";
  playlistTitle.textContent = state.playlistTitle;
  playlistMeta.textContent = `${state.playlist.length} 首`;

  if (state.playlist.length === 0) {
    playlistEmpty.hidden = false;
    playlistList.hidden = true;
    return;
  }

  playlistEmpty.hidden = true;
  playlistList.hidden = false;
  const fragment = document.createDocumentFragment();

  state.playlist.forEach((item, index) => {
    const node = playlistItemTemplate.content.cloneNode(true);
    const playlistItem = node.querySelector(".playlist-item");
    const playButton = node.querySelector(".playlist-name");
    const removeButton = node.querySelector(".playlist-remove");
    node.querySelector(".playlist-index").textContent = String(index + 1).padStart(2, "0");
    playButton.textContent = item.title;
    playlistItem.classList.toggle("is-active", index === state.currentIndex);
    playButton.addEventListener("click", () => {
      playCurrentIndex(index, true);
    });
    removeButton.addEventListener("click", () => {
      removeFromPlaylist(index);
    });
    fragment.append(node);
  });

  playlistList.append(fragment);
}

function updateNowPlaying() {
  if (state.currentIndex < 0 || state.currentIndex >= state.playlist.length) {
    nowTitle.textContent = "等待选择媒体文件";
    nowMeta.textContent = "点击目录树中的文件，或直接播放全库。";
    return;
  }

  const item = state.playlist[state.currentIndex];
  nowTitle.textContent = item.title;
  nowMeta.textContent = `${item.category} · ${item.kind === "audio" ? "音频" : "视频"} · ${state.playlistTitle}`;
}

function setMode(mode) {
  state.mode = mode;
  modeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
}

function activatePlaylist(items, title, startIndex = 0, autoplay = false) {
  state.playlist = [...items];
  state.playlistTitle = title;
  renderPlaylist();
  if (state.playlist.length === 0) {
    state.currentIndex = -1;
    updateNowPlaying();
    showIdlePlayer();
    syncPlayToggleLabel();
    return;
  }
  playCurrentIndex(startIndex, autoplay);
}

function addToPlaylist(item) {
  if (state.playlist.some((current) => current.id === item.id)) {
    return;
  }
  state.playlist.push(item);
  renderPlaylist();
}

function removeFromPlaylist(index) {
  if (index < 0 || index >= state.playlist.length) {
    return;
  }

  const removingCurrent = index === state.currentIndex;
  state.playlist.splice(index, 1);

  if (state.playlist.length === 0) {
    state.currentIndex = -1;
    showIdlePlayer();
  } else if (removingCurrent) {
    state.currentIndex = -1;
    showIdlePlayer();
  } else if (index < state.currentIndex) {
    state.currentIndex -= 1;
  }

  renderPlaylist();
  updateNowPlaying();
  syncPlayToggleLabel();
}

function playCurrentIndex(index, autoplay = true) {
  if (index < 0 || index >= state.playlist.length) {
    return;
  }

  state.currentIndex = index;
  const item = state.playlist[index];
  stopPlayers();

  if (item.kind === "audio") {
    videoPlayer.hidden = true;
    videoPlayer.pause();
    videoPlayer.removeAttribute("src");
    audioPlayer.src = item.url;
    audioPlayer.hidden = false;
    audioPlayer.load();
    if (autoplay) {
      void audioPlayer.play().catch(() => {});
    }
  } else {
    audioPlayer.hidden = true;
    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    videoPlayer.src = item.url;
    videoPlayer.hidden = false;
    videoPlayer.load();
    if (autoplay) {
      void videoPlayer.play().catch(() => {});
    }
  }

  renderPlaylist();
  updateNowPlaying();
  syncPlayToggleLabel();
}

function nextIndex() {
  if (state.playlist.length === 0) {
    return -1;
  }
  if (state.mode === "single") {
    return -1;
  }
  if (state.mode === "shuffle") {
    if (state.playlist.length === 1) {
      return 0;
    }
    let index = state.currentIndex;
    while (index === state.currentIndex) {
      index = Math.floor(Math.random() * state.playlist.length);
    }
    return index;
  }
  if (state.mode === "repeat") {
    return state.currentIndex < 0 ? 0 : state.currentIndex;
  }
  if (state.currentIndex + 1 >= state.playlist.length) {
    return 0;
  }
  return state.currentIndex + 1;
}

function previousIndex() {
  if (state.playlist.length === 0) {
    return -1;
  }
  if (state.mode === "single") {
    return state.currentIndex < 0 ? 0 : state.currentIndex;
  }
  if (state.mode === "shuffle") {
    return Math.floor(Math.random() * state.playlist.length);
  }
  if (state.mode === "repeat") {
    return state.currentIndex < 0 ? 0 : state.currentIndex;
  }
  if (state.currentIndex - 1 < 0) {
    return state.playlist.length - 1;
  }
  return state.currentIndex - 1;
}

async function fetchLibrary() {
  const response = await fetch("/api/library");
  const data = await response.json();
  state.configured = Boolean(data.configured);
  state.rootDirs = data.root_dirs || [];
  state.categories = data.categories || [];
  state.allItems = data.all_items || [];
  renderConfig();
  renderTree();
}

async function saveRootDirs(rootDirs) {
  setStatus("Scanning", "busy");

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ root_dirs: rootDirs }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "更新扫描路径失败");
    }
    setStatus("Scanned");
    await fetchLibrary();
    activatePlaylist([], "当前播放列表");
    closeSettings();
  } catch (error) {
    setStatus("Failed", "error");
    window.alert(error.message || "更新扫描路径失败");
  }
}

function openSettings() {
  settingsModal.hidden = false;
}

function closeSettings() {
  settingsModal.hidden = true;
}

function openSleepTimer() {
  renderSleepTimer();
  sleepModal.hidden = false;
}

function closeSleepTimer() {
  sleepModal.hidden = true;
}

configForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const newRootDir = rootDirInput.value.trim();
  if (!newRootDir) {
    return;
  }
  await saveRootDirs([...state.rootDirs, newRootDir]);
});

playAllButton.addEventListener("click", () => {
  activatePlaylist(state.allItems, "全库播放列表", 0, true);
});

openSettingsButton.addEventListener("click", openSettings);
closeSettingsButton.addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", closeSettings);
sleepTimerButton.addEventListener("click", openSleepTimer);
closeSleepButton.addEventListener("click", closeSleepTimer);
sleepBackdrop.addEventListener("click", closeSleepTimer);
cancelSleepButton.addEventListener("click", clearSleepTimer);

sleepForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const minutes = Number(sleepDurationInput.value);
  const stopMode = sleepModeInputs.find((input) => input.checked)?.value;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440 || !stopMode) {
    window.alert("请输入 1 到 1440 之间的分钟数。");
    return;
  }
  scheduleSleepTimer(minutes, stopMode);
  closeSleepTimer();
});

playToggleButton.addEventListener("click", () => {
  const player = activePlayer();
  if (!player) {
    if (state.playlist.length > 0) {
      playCurrentIndex(state.currentIndex >= 0 ? state.currentIndex : 0, true);
    }
    return;
  }

  if (player.paused) {
    void player.play().catch(() => {});
  } else {
    player.pause();
  }
  syncPlayToggleLabel();
});

prevButton.addEventListener("click", () => {
  const index = previousIndex();
  if (index >= 0) {
    playCurrentIndex(index, true);
  }
});

nextButton.addEventListener("click", () => {
  const index = nextIndex();
  if (index >= 0) {
    playCurrentIndex(index, true);
  }
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

[audioPlayer, videoPlayer].forEach((player) => {
  player.addEventListener("play", syncPlayToggleLabel);
  player.addEventListener("pause", syncPlayToggleLabel);
  player.addEventListener("ended", () => {
    if (state.sleepStopAfterTrack) {
      clearSleepTimer();
      return;
    }
    const index = nextIndex();
    if (index >= 0) {
      playCurrentIndex(index, true);
    }
  });
});

async function initialize() {
  showIdlePlayer();
  setMode("single");
  renderSleepTimer();
  await fetchLibrary();
  setStatus("Ready");
}

initialize().catch((error) => {
  setStatus("Failed", "error");
  window.alert(error.message || "初始化失败");
});
