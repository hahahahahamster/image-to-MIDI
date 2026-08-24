(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ImageToMidiCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function detectBackground(grays, width, height) {
    const values = Array.from(grays).sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)] || 0;
    let bright = 0;
    let dark = 0;
    let edgeTotal = 0;
    let edgeCount = 0;

    for (let i = 0; i < grays.length; i += 1) {
      const value = grays[i];
      if (value >= 180) bright += 1;
      if (value <= 80) dark += 1;
      const x = i % width;
      const y = Math.floor(i / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        edgeTotal += value;
        edgeCount += 1;
      }
    }

    const brightRatio = bright / grays.length;
    const darkRatio = dark / grays.length;
    const edgeMean = edgeCount ? edgeTotal / edgeCount : median;
    if ((edgeMean >= 180 && brightRatio >= 0.35) || edgeMean >= 205 || (brightRatio >= 0.5 && median >= 180)) return "light";
    if ((edgeMean <= 80 && darkRatio >= 0.35) || edgeMean <= 55 || (darkRatio >= 0.5 && median <= 80)) return "dark";
    if (darkRatio > brightRatio + 0.1) return "dark";
    if (brightRatio > darkRatio + 0.1) return "light";
    return median >= 128 ? "light" : "dark";
  }

  function otsuThreshold(grays) {
    const histogram = new Uint32Array(256);
    for (const value of grays) histogram[value] += 1;
    const total = grays.length;
    let sum = 0;
    for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestVariance = -1;
    let threshold = 128;
    for (let i = 0; i < 256; i += 1) {
      backgroundWeight += histogram[i];
      if (!backgroundWeight) continue;
      const foregroundWeight = total - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += i * histogram[i];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (sum - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = i;
      }
    }
    return threshold;
  }

  function dilate(mask, width, height) {
    const output = new Uint8Array(mask.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let active = 0;
        for (let oy = -1; oy <= 1 && !active; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx]) {
              active = 1;
              break;
            }
          }
        }
        output[y * width + x] = active;
      }
    }
    return output;
  }

  function erode(mask, width, height) {
    const output = new Uint8Array(mask.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let active = 1;
        for (let oy = -1; oy <= 1 && active; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height || !mask[ny * width + nx]) {
              active = 0;
              break;
            }
          }
        }
        output[y * width + x] = active;
      }
    }
    return output;
  }

  function removeSmallComponents(mask, width, height) {
    if (mask.length > 450000) return mask;
    const output = new Uint8Array(mask.length);
    const visited = new Uint8Array(mask.length);
    const minArea = Math.max(2, Math.min(32, Math.floor(mask.length * 0.0004)));
    const stack = [];
    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || visited[start]) continue;
      const component = [];
      stack.push(start);
      visited[start] = 1;
      while (stack.length) {
        const current = stack.pop();
        component.push(current);
        const x = current % width;
        const y = Math.floor(current / width);
        const neighbors = [
          x > 0 ? current - 1 : -1,
          x < width - 1 ? current + 1 : -1,
          y > 0 ? current - width : -1,
          y < height - 1 ? current + width : -1
        ];
        for (const next of neighbors) {
          if (next >= 0 && mask[next] && !visited[next]) {
            visited[next] = 1;
            stack.push(next);
          }
        }
      }
      if (component.length >= minArea) {
        for (const index of component) output[index] = 1;
      }
    }
    return output;
  }

  function createMask(grays, width, height, options = {}) {
    const requestedBackground = options.background || "auto";
    const background = requestedBackground === "auto" ? detectBackground(grays, width, height) : requestedBackground;
    const threshold = requestedBackground === "auto" ? otsuThreshold(grays) : clamp(Number(options.threshold ?? 128), 0, 255);
    let mask = new Uint8Array(grays.length);
    let active = 0;
    for (let i = 0; i < grays.length; i += 1) {
      const note = background === "light" ? grays[i] <= threshold : grays[i] >= threshold;
      mask[i] = note ? 1 : 0;
      active += mask[i];
    }

    if (mask.length <= 220000) mask = erode(dilate(mask, width, height), width, height);
    mask = removeSmallComponents(mask, width, height);
    active = mask.reduce((sum, value) => sum + value, 0);
    if (active / mask.length > 0.58) {
      for (let i = 0; i < mask.length; i += 1) mask[i] = mask[i] ? 0 : 1;
      active = mask.length - active;
    }
    return { mask, background, threshold, active };
  }

  function variableLength(value) {
    let buffer = value & 0x7f;
    const bytes = [];
    while ((value >>= 7)) {
      buffer <<= 8;
      buffer |= (value & 0x7f) | 0x80;
    }
    while (true) {
      bytes.push(buffer & 0xff);
      if (buffer & 0x80) buffer >>= 8;
      else break;
    }
    return bytes;
  }

  function uint32(value) {
    return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  }

  function uint16(value) {
    return [(value >>> 8) & 255, value & 255];
  }

  function buildMidi(mask, width, height, options = {}) {
    const startNote = clamp(Number(options.startNote ?? 36), 0, 127);
    const tempo = clamp(Number(options.tempo ?? 120), 30, 300);
    const ppq = 96;
    const stepTicks = 24;
    const pitchRows = new Map();
    const notes = [];

    for (let y = 0; y < height; y += 1) {
      const relative = height > 1 ? (height - y - 1) / (height - 1) : 0;
      const available = 127 - startNote;
      const pitch = clamp(Math.round(startNote + relative * Math.min(height - 1, available)), 0, 127);
      if (!pitchRows.has(pitch)) pitchRows.set(pitch, new Uint8Array(width));
      const row = pitchRows.get(pitch);
      for (let x = 0; x < width; x += 1) {
        if (mask[y * width + x]) row[x] = 1;
      }
    }

    const events = [];
    let noteCount = 0;
    for (const [pitch, row] of pitchRows) {
      let x = 0;
      while (x < width) {
        if (!row[x]) { x += 1; continue; }
        const start = x;
        while (x < width && row[x]) x += 1;
        const end = x;
        events.push({ tick: start * stepTicks, order: 1, bytes: [0x90, pitch, 100] });
        events.push({ tick: end * stepTicks, order: 0, bytes: [0x80, pitch, 0] });
        notes.push({ pitch, startBeat: start / 4, durationBeats: (end - start) / 4 });
        noteCount += 1;
      }
    }
    events.sort((a, b) => a.tick - b.tick || a.order - b.order || a.bytes[1] - b.bytes[1]);
    notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);

    const track = [];
    const name = Array.from(new TextEncoder().encode("Image to MIDI"));
    track.push(0x00, 0xff, 0x03, name.length, ...name);
    const micros = Math.round(60000000 / tempo);
    track.push(0x00, 0xff, 0x51, 0x03, (micros >>> 16) & 255, (micros >>> 8) & 255, micros & 255);
    let previousTick = 0;
    for (const event of events) {
      track.push(...variableLength(event.tick - previousTick), ...event.bytes);
      previousTick = event.tick;
    }
    track.push(0x00, 0xff, 0x2f, 0x00);

    const bytes = [
      0x4d, 0x54, 0x68, 0x64, ...uint32(6), ...uint16(0), ...uint16(1), ...uint16(ppq),
      0x4d, 0x54, 0x72, 0x6b, ...uint32(track.length), ...track
    ];
    return { bytes: new Uint8Array(bytes), noteCount, durationBeats: width / 4, notes };
  }

  function getNoteName(note) {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const safe = clamp(Number(note), 0, 127);
    return `${names[safe % 12]}${Math.floor(safe / 12) - 1}`;
  }

  return { clamp, detectBackground, otsuThreshold, createMask, buildMidi, getNoteName };
});
