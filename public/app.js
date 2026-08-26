(function () {
  "use strict";

  const core = window.ImageToMidiCore;
  const form = document.getElementById("convert-form");
  const fileInput = document.getElementById("image-input");
  const dropZone = document.getElementById("drop-zone");
  const dropTitle = document.getElementById("drop-title");
  const dropCopy = document.getElementById("drop-copy");
  const preview = document.getElementById("image-preview");
  const placeholder = document.getElementById("preview-placeholder");
  const clearButton = document.getElementById("clear-button");
  const demoButton = document.getElementById("demo-button");
  const resetButton = document.getElementById("reset-button");
  const convertButton = document.getElementById("convert-button");
  const statusMessage = document.getElementById("status-message");
  const errorMessage = document.getElementById("error-message");
  const threshold = document.getElementById("threshold");
  const thresholdOutput = document.getElementById("threshold-output");
  const background = document.getElementById("background");
  const widthNotes = document.getElementById("width-notes");
  const heightNotes = document.getElementById("height-notes");
  const startNote = document.getElementById("start-note");
  const tempo = document.getElementById("tempo");
  const pitchInfo = document.getElementById("pitch-info");
  const rollCanvas = document.getElementById("roll-canvas");
  const rollMeta = document.getElementById("roll-meta");
  const rollContext = rollCanvas.getContext("2d");
  const midiPlayer = document.getElementById("midi-player");
  const playerPlay = document.getElementById("player-play");
  const playerStop = document.getElementById("player-stop");
  const playerPosition = document.getElementById("player-position");
  const playerCurrentTime = document.getElementById("player-current-time");
  const playerDuration = document.getElementById("player-duration");
  const playerVolume = document.getElementById("player-volume");
  const playerStatus = document.getElementById("player-status");
  const playerReady = document.getElementById("player-ready");
  const DOWNLOAD_SPONSOR_URL = "https://pleased-report.com/b.3sVT0YP-3VpXv/bVm-VTJVZHDQ0/3HMVzoU-wQM/zPYL1/LNT/cqzUNNTlAlz/NtjJkQ";
  let currentFile = null;
  let currentImage = null;
  let currentObjectUrl = null;
  let previewTimer = null;
  let lastConversion = null;
  let audioContext = null;
  let masterGain = null;
  let playerData = null;
  let playerTimer = null;
  let playerStartedAt = 0;
  let playerOffset = 0;
  let nextNoteIndex = 0;
  let isPlaying = false;
  const activeVoices = new Set();

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
    statusMessage.textContent = "Conversion stopped.";
  }

  function clearError() {
    errorMessage.textContent = "";
    errorMessage.hidden = true;
  }

  function openDownloadSponsor() {
    const link = document.createElement("a");
    link.href = DOWNLOAD_SPONSOR_URL;
    link.target = "_blank";
    link.rel = "sponsored nofollow noopener noreferrer";
    link.tabIndex = -1;
    link.setAttribute("aria-hidden", "true");
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function updatePitchInfo() {
    const start = core.clamp(Number(startNote.value) || 0, 0, 127);
    const rows = core.clamp(Number(heightNotes.value) || 8, 8, 400);
    const end = Math.min(127, start + rows - 1);
    const scaled = start + rows - 1 > 127 ? " · scaled to fit MIDI range" : "";
    pitchInfo.textContent = `${core.getNoteName(start)} to ${core.getNoteName(end)}${scaled}`;
  }

  function drawEmptyRoll() {
    const width = rollCanvas.width;
    const height = rollCanvas.height;
    rollContext.fillStyle = "#131110";
    rollContext.fillRect(0, 0, width, height);
    rollContext.strokeStyle = "rgba(255,255,255,.055)";
    rollContext.lineWidth = 1;
    for (let x = 0; x <= width; x += 40) {
      rollContext.beginPath(); rollContext.moveTo(x, 0); rollContext.lineTo(x, height); rollContext.stroke();
    }
    for (let y = 0; y <= height; y += 20) {
      rollContext.beginPath(); rollContext.moveTo(0, y); rollContext.lineTo(width, y); rollContext.stroke();
    }
    rollContext.fillStyle = "#8f837a";
    rollContext.textAlign = "center";
    rollContext.font = "600 14px system-ui";
    rollContext.fillText("Detected notes will appear here", width / 2, height / 2);
  }

  function drawRoll(mask, width, height) {
    const displayWidth = 1000;
    const displayHeight = 360;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    rollCanvas.width = displayWidth * dpr;
    rollCanvas.height = displayHeight * dpr;
    rollContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    rollContext.fillStyle = "#131110";
    rollContext.fillRect(0, 0, displayWidth, displayHeight);
    const cellWidth = displayWidth / width;
    const cellHeight = displayHeight / height;
    rollContext.strokeStyle = "rgba(255,255,255,.05)";
    rollContext.lineWidth = 1;
    for (let x = 0; x <= displayWidth; x += Math.max(32, cellWidth * 16)) {
      rollContext.beginPath(); rollContext.moveTo(x, 0); rollContext.lineTo(x, displayHeight); rollContext.stroke();
    }
    for (let y = 0; y <= displayHeight; y += Math.max(24, cellHeight * 12)) {
      rollContext.beginPath(); rollContext.moveTo(0, y); rollContext.lineTo(displayWidth, y); rollContext.stroke();
    }
    const gradient = rollContext.createLinearGradient(0, 0, displayWidth, displayHeight);
    gradient.addColorStop(0, "#ff7a1a");
    gradient.addColorStop(1, "#4f7cff");
    rollContext.fillStyle = gradient;
    for (let y = 0; y < height; y += 1) {
      let x = 0;
      while (x < width) {
        if (!mask[y * width + x]) { x += 1; continue; }
        const start = x;
        while (x < width && mask[y * width + x]) x += 1;
        const rectX = start * cellWidth;
        const rectWidth = Math.max(1, (x - start) * cellWidth - .35);
        const rectY = y * cellHeight;
        rollContext.fillRect(rectX, rectY, rectWidth, Math.max(1, cellHeight - .35));
      }
    }
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const minutes = Math.floor(safe / 60);
    const remainder = Math.floor(safe % 60).toString().padStart(2, "0");
    return `${minutes}:${remainder}`;
  }

  function setPlayerButtonState() {
    const playIcon = playerPlay.querySelector(".play-icon");
    const pauseIcon = playerPlay.querySelector(".pause-icon");
    const label = playerPlay.querySelector("span");
    playIcon.hidden = isPlaying;
    pauseIcon.hidden = !isPlaying;
    label.textContent = isPlaying ? "Pause" : (playerData && playerOffset >= playerData.durationSeconds ? "Replay" : "Play");
    playerPlay.setAttribute("aria-label", isPlaying ? "Pause MIDI preview" : "Play MIDI preview");
    playerPlay.disabled = !playerData || !playerData.notes.length;
    playerStop.disabled = !playerData || (!isPlaying && playerOffset <= 0);
  }

  function updatePlayerPosition(seconds = playerOffset) {
    const duration = playerData?.durationSeconds || 0;
    const safe = core.clamp(seconds, 0, duration);
    playerOffset = safe;
    playerPosition.value = duration ? String(Math.round((safe / duration) * 1000)) : "0";
    playerCurrentTime.textContent = formatTime(safe);
    playerDuration.textContent = formatTime(duration);
    setPlayerButtonState();
  }

  function stopActiveVoices() {
    for (const voice of activeVoices) {
      try { voice.stop(); } catch (_) { /* already stopped */ }
    }
    activeVoices.clear();
  }

  function stopPlayback(reset = true, message = "Playback stopped.") {
    clearTimeout(playerTimer);
    playerTimer = null;
    if (isPlaying && audioContext) playerOffset = core.clamp(audioContext.currentTime - playerStartedAt, 0, playerData?.durationSeconds || 0);
    isPlaying = false;
    stopActiveVoices();
    if (reset) playerOffset = 0;
    updatePlayerPosition(playerOffset);
    if (playerData) playerStatus.textContent = message;
  }

  function pausePlayback() {
    if (!isPlaying || !audioContext) return;
    playerOffset = core.clamp(audioContext.currentTime - playerStartedAt, 0, playerData.durationSeconds);
    isPlaying = false;
    clearTimeout(playerTimer);
    playerTimer = null;
    stopActiveVoices();
    updatePlayerPosition(playerOffset);
    playerStatus.textContent = `Paused at ${formatTime(playerOffset)}.`;
  }

  function ensureAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio playback is not available in this browser.");
    if (!audioContext) {
      audioContext = new AudioContextClass();
      masterGain = audioContext.createGain();
      masterGain.gain.value = Number(playerVolume.value) / 100;
      masterGain.connect(audioContext.destination);
    }
    return audioContext;
  }

  function scheduleVoice(note, positionSeconds) {
    if (!audioContext || !playerData || activeVoices.size >= 96) return;
    const secondsPerBeat = 60 / playerData.tempo;
    const noteStart = note.startBeat * secondsPerBeat;
    const noteEnd = (note.startBeat + note.durationBeats) * secondsPerBeat;
    if (noteEnd <= positionSeconds) return;
    const startAt = audioContext.currentTime + Math.max(.012, noteStart - positionSeconds);
    const endAt = audioContext.currentTime + Math.max(.04, noteEnd - positionSeconds);
    if (endAt <= startAt) return;

    const oscillator = audioContext.createOscillator();
    const envelope = audioContext.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(440 * 2 ** ((note.pitch - 69) / 12), startAt);
    envelope.gain.setValueAtTime(.0001, startAt);
    envelope.gain.exponentialRampToValueAtTime(.018, Math.min(startAt + .018, endAt - .01));
    envelope.gain.setValueAtTime(.012, Math.max(startAt + .02, endAt - .035));
    envelope.gain.exponentialRampToValueAtTime(.0001, endAt);
    oscillator.connect(envelope);
    envelope.connect(masterGain);
    oscillator.onended = () => {
      activeVoices.delete(oscillator);
      oscillator.disconnect();
      envelope.disconnect();
    };
    activeVoices.add(oscillator);
    oscillator.start(startAt);
    oscillator.stop(endAt + .01);
  }

  function playerTick() {
    if (!isPlaying || !audioContext || !playerData) return;
    const position = audioContext.currentTime - playerStartedAt;
    const lookAhead = position + .35;
    const secondsPerBeat = 60 / playerData.tempo;
    while (nextNoteIndex < playerData.notes.length) {
      const note = playerData.notes[nextNoteIndex];
      const startSeconds = note.startBeat * secondsPerBeat;
      if (startSeconds > lookAhead) break;
      scheduleVoice(note, position);
      nextNoteIndex += 1;
    }
    updatePlayerPosition(position);
    if (position >= playerData.durationSeconds) {
      isPlaying = false;
      stopActiveVoices();
      playerOffset = playerData.durationSeconds;
      updatePlayerPosition(playerOffset);
      playerStatus.textContent = "Playback finished. Select Replay to listen again.";
      return;
    }
    playerTimer = setTimeout(playerTick, 80);
  }

  async function startPlayback() {
    if (!playerData?.notes.length) return;
    try {
      const context = ensureAudioContext();
      await context.resume();
      if (playerOffset >= playerData.durationSeconds) playerOffset = 0;
      stopActiveVoices();
      const secondsPerBeat = 60 / playerData.tempo;
      nextNoteIndex = 0;
      while (nextNoteIndex < playerData.notes.length) {
        const note = playerData.notes[nextNoteIndex];
        const noteEnd = (note.startBeat + note.durationBeats) * secondsPerBeat;
        if (noteEnd > playerOffset) break;
        nextNoteIndex += 1;
      }
      playerStartedAt = context.currentTime - playerOffset;
      isPlaying = true;
      setPlayerButtonState();
      playerStatus.textContent = `Playing ${playerData.notes.length.toLocaleString()} note shapes with the browser synth.`;
      playerTick();
    } catch (error) {
      playerStatus.textContent = error.message || "Playback could not start.";
    }
  }

  function preparePlayer(conversion, { scroll = true } = {}) {
    stopPlayback(true);
    const secondsPerBeat = 60 / conversion.settings.tempo;
    playerData = {
      notes: conversion.midi.notes,
      tempo: conversion.settings.tempo,
      durationSeconds: conversion.midi.durationBeats * secondsPerBeat
    };
    midiPlayer.hidden = false;
    midiPlayer.removeAttribute("hidden");
    playerReady.textContent = playerData.notes.length ? "MIDI ready" : "No notes detected";
    playerStatus.textContent = playerData.notes.length
      ? `MIDI ready: ${playerData.notes.length.toLocaleString()} note shapes. Select Play to preview.`
      : "The generated MIDI contains no notes. Adjust the image or threshold and convert again.";
    updatePlayerPosition(0);
    if (scroll) requestAnimationFrame(() => midiPlayer.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  function invalidatePlayer() {
    if (playerData) stopPlayback(true);
    playerData = null;
    midiPlayer.hidden = false;
    midiPlayer.removeAttribute("hidden");
    playerReady.textContent = "Waiting for MIDI";
    playerStatus.textContent = "Convert an image to enable playback.";
    updatePlayerPosition(0);
  }

  function imageToGrays(image, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const grays = new Uint8Array(width * height);
    for (let i = 0, pixel = 0; i < rgba.length; i += 4, pixel += 1) {
      const alpha = rgba[i + 3] / 255;
      const luminance = .2126 * rgba[i] + .7152 * rgba[i + 1] + .0722 * rgba[i + 2];
      grays[pixel] = Math.round(luminance * alpha + 255 * (1 - alpha));
    }
    return grays;
  }

  function validateSettings() {
    const values = {
      width: Number(widthNotes.value),
      height: Number(heightNotes.value),
      start: Number(startNote.value),
      tempo: Number(tempo.value),
      threshold: Number(threshold.value),
      background: background.value
    };
    if (!Number.isInteger(values.width) || values.width < 8 || values.width > 1000) throw new Error("Time resolution must be an integer from 8 to 1000.");
    if (!Number.isInteger(values.height) || values.height < 8 || values.height > 400) throw new Error("Pitch resolution must be an integer from 8 to 400.");
    if (!Number.isInteger(values.start) || values.start < 0 || values.start > 127) throw new Error("Lowest MIDI note must be an integer from 0 to 127.");
    if (!Number.isInteger(values.tempo) || values.tempo < 30 || values.tempo > 300) throw new Error("Tempo must be an integer from 30 to 300 BPM.");
    return values;
  }

  function processCurrentImage() {
    if (!currentImage) return null;
    const settings = validateSettings();
    const grays = imageToGrays(currentImage, settings.width, settings.height);
    const detection = core.createMask(grays, settings.width, settings.height, settings);
    const midi = core.buildMidi(detection.mask, settings.width, settings.height, { startNote: settings.start, tempo: settings.tempo });
    drawRoll(detection.mask, settings.width, settings.height);
    rollMeta.textContent = `${midi.noteCount.toLocaleString()} note shapes · ${detection.background} background · threshold ${detection.threshold}`;
    return { settings, detection, midi };
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    if (!currentImage) return;
    previewTimer = setTimeout(() => {
      try {
        clearError();
        lastConversion = processCurrentImage();
        preparePlayer(lastConversion, { scroll: false });
        statusMessage.textContent = "Preview updated. MIDI ready to play or download.";
      } catch (error) {
        showError(error.message);
      }
    }, 180);
  }

  function releaseImage() {
    invalidatePlayer();
    currentFile = null;
    currentImage = null;
    lastConversion = null;
    fileInput.value = "";
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
    preview.removeAttribute("src");
    preview.hidden = true;
    placeholder.hidden = false;
    clearButton.hidden = true;
    convertButton.disabled = true;
    dropTitle.textContent = "Drop an image here";
    dropCopy.textContent = "or choose a file from your device";
    rollMeta.textContent = "Add an image to see detected notes";
    drawEmptyRoll();
  }

  function loadFile(file) {
    clearError();
    invalidatePlayer();
    if (!file || !file.type.startsWith("image/")) {
      showError("Choose a PNG, JPG, GIF, BMP, or WebP image.");
      return;
    }
    if (file.size > 16 * 1024 * 1024) {
      showError("The image is larger than 16 MB. Choose a smaller file.");
      return;
    }
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      currentFile = file;
      currentImage = image;
      preview.src = currentObjectUrl;
      preview.hidden = false;
      placeholder.hidden = true;
      clearButton.hidden = false;
      convertButton.disabled = false;
      dropTitle.textContent = file.name || "Pasted image";
      dropCopy.textContent = `${image.naturalWidth} × ${image.naturalHeight} px · ${(file.size / 1024).toFixed(1)} KB`;
      statusMessage.textContent = "Image loaded. Building MIDI preview…";
      schedulePreview();
    };
    image.onerror = () => showError("This image could not be decoded by your browser.");
    image.src = currentObjectUrl;
  }

  function makeDemoFile() {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 420;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fffaf5";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#171412";
    context.lineWidth = 30;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(110, 190);
    context.bezierCurveTo(110, 80, 270, 80, 360, 205);
    context.bezierCurveTo(450, 80, 610, 80, 610, 190);
    context.bezierCurveTo(610, 285, 500, 335, 360, 365);
    context.bezierCurveTo(220, 335, 110, 285, 110, 190);
    context.stroke();
    canvas.toBlob((blob) => {
      if (blob) loadFile(new File([blob], "demo-heart.png", { type: "image/png" }));
    }, "image/png");
  }

  function safeFilename() {
    const base = (currentFile?.name || "image").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "image";
    return `${base}-to-midi.mid`;
  }

  fileInput.addEventListener("change", () => loadFile(fileInput.files[0]));
  ["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  }));
  dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));
  document.addEventListener("paste", (event) => {
    const item = Array.from(event.clipboardData?.items || []).find((entry) => entry.type.startsWith("image/"));
    if (item) {
      event.preventDefault();
      loadFile(item.getAsFile());
    }
  });
  clearButton.addEventListener("click", () => {
    releaseImage();
    statusMessage.textContent = "Image removed.";
  });
  demoButton.addEventListener("click", makeDemoFile);
  threshold.addEventListener("input", () => { thresholdOutput.textContent = threshold.value; invalidatePlayer(); schedulePreview(); });
  [background, widthNotes, heightNotes, startNote, tempo].forEach((control) => control.addEventListener("input", () => {
    updatePitchInfo();
    invalidatePlayer();
    schedulePreview();
  }));
  playerPlay.addEventListener("click", () => { if (isPlaying) pausePlayback(); else startPlayback(); });
  playerStop.addEventListener("click", () => stopPlayback(true));
  playerPosition.addEventListener("input", () => {
    const duration = playerData?.durationSeconds || 0;
    const previewPosition = duration * Number(playerPosition.value) / 1000;
    playerCurrentTime.textContent = formatTime(previewPosition);
  });
  playerPosition.addEventListener("change", () => {
    if (!playerData) return;
    const wasPlaying = isPlaying;
    if (isPlaying) pausePlayback();
    playerOffset = playerData.durationSeconds * Number(playerPosition.value) / 1000;
    updatePlayerPosition(playerOffset);
    playerStatus.textContent = `Moved to ${formatTime(playerOffset)}.`;
    if (wasPlaying) startPlayback();
  });
  playerVolume.addEventListener("input", () => {
    if (masterGain && audioContext) masterGain.gain.setTargetAtTime(Number(playerVolume.value) / 100, audioContext.currentTime, .015);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();
    if (!currentImage) {
      showError("Add an image before converting.");
      return;
    }
    // Open from the download click task so the browser recognizes the user gesture.
    openDownloadSponsor();
    convertButton.disabled = true;
    convertButton.querySelector("span").textContent = "Converting…";
    statusMessage.textContent = "Generating your MIDI file locally…";
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
      lastConversion = processCurrentImage();
      const blob = new Blob([lastConversion.midi.bytes], { type: "audio/midi" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeFilename();
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      statusMessage.textContent = `Downloaded ${anchor.download} with ${lastConversion.midi.noteCount.toLocaleString()} note shapes.`;
      preparePlayer(lastConversion);
    } catch (error) {
      showError(error.message || "The MIDI file could not be generated.");
    } finally {
      convertButton.disabled = !currentImage;
      convertButton.querySelector("span").textContent = "Convert and download";
    }
  });
  form.addEventListener("reset", () => {
    setTimeout(() => {
      thresholdOutput.textContent = threshold.value;
      updatePitchInfo();
      releaseImage();
      clearError();
      statusMessage.textContent = "Settings reset.";
    });
  });
  resetButton.addEventListener("click", () => clearError());
  window.addEventListener("resize", () => { if (lastConversion) drawRoll(lastConversion.detection.mask, lastConversion.settings.width, lastConversion.settings.height); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && isPlaying) pausePlayback(); });
  window.addEventListener("pagehide", () => stopPlayback(true));

  thresholdOutput.textContent = threshold.value;
  updatePitchInfo();
  drawEmptyRoll();
})();
