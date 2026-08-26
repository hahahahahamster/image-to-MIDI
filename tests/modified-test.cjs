const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../public/converter-core.js");

const darkGrid = new Uint8Array([
  0, 0, 0, 0, 0, 0,
  0, 0, 240, 240, 0, 0,
  0, 0, 240, 240, 0, 0,
  0, 0, 0, 0, 0, 0
]);
const detected = core.detectBackground(darkGrid, 6, 4);
assert.equal(detected, "dark");
const conversion = core.createMask(darkGrid, 6, 4, { background: "dark", threshold: 128 });
const midi = core.buildMidi(conversion.mask, 6, 4, { startNote: 36, tempo: 120 });
assert.equal(Buffer.from(midi.bytes.subarray(0, 4)).toString("ascii"), "MThd");
assert.ok(midi.noteCount > 0);
assert.equal(midi.notes.length, midi.noteCount);
assert.ok(midi.notes.every((note) => Number.isFinite(note.startBeat) && note.durationBeats > 0 && note.pitch >= 0 && note.pitch <= 127));

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
for (const required of [
  "<link rel=\"canonical\" href=\"https://img2midi.online/\">",
  "\"@type\": \"WebApplication\"",
  "\"@type\": \"HowTo\"",
  "\"@type\": \"FAQPage\"",
  "entire conversion runs locally in your browser",
  "id=\"midi-player\"",
  "id=\"player-ready\"",
  "Waiting for MIDI",
  "Convert an image to enable playback.",
  "id=\"player-play\" type=\"button\" aria-label=\"Play MIDI preview\" disabled",
  "built-in browser synthesizer",
  "Image to MIDI Converter – Free Online PNG/JPG to MIDI",
  "<script src=\"/app.js?v=player-visible-20260826\" defer></script>",
  "<meta name=\"referrer\" content=\"no-referrer-when-downgrade\">",
  "ca-pub-8253931220564393",
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8253931220564393",
  "fond-appointment.com/boXxV.sBdBGbl/0/Y/WYcL/Ee-mz9huWZQUUl/k/PmTmcozLNPTaAf0_MXDGkAt_NAzqMA1IMtDSQaxPM/wp",
  "fond-appointment.com/bLXxVJsKd.GWlB0gYiWhcv/kecm/9AujZWUKlAkHPaTqcjzLNSTTA/0pMCjCE/tTNzz-MS1/MHDAQ/yyN/QY",
  "fond-appointment.com/b/X.Vps/dIGclY0yY/WJcB/_eOmx9CuQZGUil/kJPqTGc/z/NyTyAF0HMBz/c/toNnz/MD1TM/DjQD0jMeQD",
  "fond-appointment.com/bzX/VUsod.GElX0UY/WvcU/keUm/9vusZhUclSk/P/TScXzwNVTBAq0yNcTWMLt_NwzCMJ1rMLDUQx1yN/w_"
]) assert.ok(html.includes(required), `missing: ${required}`);
assert.ok(!html.includes('class="sponsor-card"'), "sponsor card should be removed from the page");
assert.ok(!html.includes("Open sponsored link"), "sponsor link should not be visible in the page");

const appJs = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
for (const required of [
  "AudioContext",
  "startPlayback",
  "pausePlayback",
  "preparePlayer",
  "removeAttribute(\"hidden\")",
  "scrollIntoView",
  "player-position",
  "DOWNLOAD_SPONSOR_URL",
  "openDownloadSponsor",
  "target = \"_blank\"",
  "rel = \"sponsored nofollow noopener noreferrer\"",
  "https://pleased-report.com/b.3sVT0YP-3VpXv/bVm-VTJVZHDQ0/3HMVzoU-wQM/zPYL1/LNT/cqzUNNTlAlz/NtjJkQ"
]) {
  assert.ok(appJs.includes(required), `missing playback implementation: ${required}`);
}

for (const file of ["robots.txt", "sitemap.xml", "llms.txt", "site.webmanifest", "og-image.png", "_headers"]) {
  assert.ok(fs.existsSync(path.join(__dirname, "../public", file)), `missing public/${file}`);
}
const headers = fs.readFileSync(path.join(__dirname, "../public/_headers"), "utf8");
assert.ok(headers.includes("/*.js") && headers.includes("Cache-Control: no-cache, must-revalidate"), "JavaScript cache must revalidate so player fixes reach visitors");
assert.ok(headers.includes("pagead2.googlesyndication.com"), "CSP must allow Google AdSense");
assert.ok(headers.includes("ep1.adtrafficquality.google"), "CSP must allow AdSense traffic quality");
assert.ok(headers.includes("ep2.adtrafficquality.google"), "CSP must allow AdSense SODAR");
assert.ok(headers.includes("https://www.google.com"), "CSP must allow the AdSense verification frame");
assert.ok(headers.includes("fond-appointment.com"), "CSP must allow fond-appointment scripts");

console.log(`MODIFIED seo_title=true canonical=true schema_types=WebApplication,HowTo,FAQPage web_audio=true player_reveal=true player_scroll=true app_cache_revalidate=true download_sponsor_tab=true sponsor_card=removed background=${detected} midi_header=${Buffer.from(midi.bytes.subarray(0, 4)).toString("ascii")} midi_bytes=${midi.bytes.length} note_shapes=${midi.noteCount} player_notes=${midi.notes.length}`);
