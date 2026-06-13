const state = {
  configured: false,
  rootDir: "",
  categories: [],
  allItems: [],
  playlist: [],
  playlistTitle: "当前播放列表",
  currentIndex: -1,
  mode: "single",
};

const configForm = document.getElementById("config-form");
const rootDirInput = document.getElementById("root-dir-input");
const configStatus = document.getElementById("config-status");
const openSettingsButton = document.getElementById("open-settings-button");
const closeSettingsButton = document.getElementById("close-settings-button");
const settingsModal = document.getElementById("settings-modal");
const settingsBackdrop = document.getElementById("settings-backdrop");
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

function renderConfig() {
  rootDirInput.value = state.rootDir;
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
    const playButton = node.querySelector(".category-play");
    const filesContainer = node.querySelector(".category-files");

    toggle.textContent = `${category.name} · ${category.items.length}`;
    toggle.addEventListener("click", () => {
      block.classList.toggle("is-open");
    });
    playButton.addEventListener("click", () => {
      setMode("sequence");
      activatePlaylist(category.items, `${category.name} 播放列表`, 0, true);
    });

    category.items.forEach((item) => {
      const fileNode = fileTemplate.content.cloneNode(true);
      const button = fileNode.querySelector(".file-node");
      fileNode.querySelector(".file-kind").textContent = item.kind === "audio" ? "音频" : "视频";
      fileNode.querySelector(".file-name").textContent = item.title;
      button.addEventListener("click", () => {
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
    const button = node.querySelector(".playlist-item");
    node.querySelector(".playlist-index").textContent = String(index + 1).padStart(2, "0");
    node.querySelector(".playlist-name").textContent = item.title;
    node.querySelector(".playlist-kind").textContent = item.kind === "audio" ? "AUDIO" : "VIDEO";
    button.classList.toggle("is-active", index === state.currentIndex);
    button.addEventListener("click", () => {
      playCurrentIndex(index, true);
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
  state.rootDir = data.root_dir || "";
  state.categories = data.categories || [];
  state.allItems = data.all_items || [];
  renderConfig();
  renderTree();
}

function openSettings() {
  settingsModal.hidden = false;
}

function closeSettings() {
  settingsModal.hidden = true;
}

configForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Scanning", "busy");

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ root_dir: rootDirInput.value.trim() }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "设置根目录失败");
    }
    setStatus("Scanned");
    await fetchLibrary();
    activatePlaylist([], "当前播放列表");
    closeSettings();
  } catch (error) {
    setStatus("Failed", "error");
    window.alert(error.message || "设置根目录失败");
  }
});

playAllButton.addEventListener("click", () => {
  activatePlaylist(state.allItems, "全库播放列表", 0, true);
});

openSettingsButton.addEventListener("click", openSettings);
closeSettingsButton.addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", closeSettings);

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
    const index = nextIndex();
    if (index >= 0) {
      playCurrentIndex(index, true);
    }
  });
});

async function initialize() {
  showIdlePlayer();
  setMode("single");
  await fetchLibrary();
  setStatus("Ready");
}

initialize().catch((error) => {
  setStatus("Failed", "error");
  window.alert(error.message || "初始化失败");
});
