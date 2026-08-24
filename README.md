# Image to MIDI Converter

A free web application that converts image shapes into playable MIDI notes. The Cloudflare Pages version processes images entirely in the browser, previews the generated sequence with a built-in Web Audio synth, and downloads a Standard MIDI File.

**Live site:** https://image-to-midi-converter.pages.dev/

## Features

- 🎨 **Smart Image Processing**: Automatically detects background type (dark/light) and handles color images
- 🎵 **Customizable Parameters**: Adjust width, height, start note, and threshold
- 🌐 **Web Interface**: Beautiful, modern UI for easy image upload and conversion
- 📥 **Instant Download**: Generated MIDI files download automatically
- ▶ **Online MIDI Preview**: Play, pause, stop, seek, and change preview volume after conversion
- 🔒 **Private Browser Processing**: The Cloudflare version does not upload or store images
- 🔎 **SEO/GEO Ready**: Canonical metadata, structured data, sitemap, robots.txt, and llms.txt

## Cloudflare Pages version

The production site is a static HTML/CSS/JavaScript app in [`public/`](./public). Image decoding, note extraction, MIDI generation, and audio preview all use browser APIs, so the feature works on Cloudflare Pages without a Python runtime, server function, database, or paid service.

### Local development

```bash
npm test
npm run preview
```

### Deploy

```bash
npx wrangler whoami
npx wrangler pages deploy public --project-name=image-to-midi-converter --branch=main
```

Cloudflare assigns the free domain `https://image-to-midi-converter.pages.dev/`.

### Browser playback

After **Convert and download** finishes, the MIDI player appears below the piano-roll preview. It uses the Web Audio API and a lightweight triangle-wave synth. The downloaded MIDI contains note timing and pitch data only; the final sound depends on the instrument selected in a DAW.

## Legacy Flask version

The original Python/Flask implementation remains available in `app.py`.

### Flask installation

1. Install Python 3.8 or higher

2. Install dependencies:
```bash
pip install -r requirements.txt
```

### Flask usage

1. Start the web server:
```bash
python app.py
```

2. Open your browser and navigate to:
```
http://localhost:5000
```

3. Upload an image and adjust parameters:
   - **Width (Notes)**: Song length - how many notes wide (1-500)
   - **Height (Notes)**: Pitch range - how many semitones (1-200)
   - **Start Note**: Lowest pitch (0-127, 36 = C2)
   - **Threshold**: Brightness threshold (0-255, lower = more details)
   - **Auto-detect**: Automatically handles dark/light/color backgrounds

4. Click "Convert to MIDI" and download your file!

## Parameters Explained

- **Width Notes**: Controls the horizontal compression - how many notes the image spans
- **Height Notes**: Controls the vertical range - how many semitones the image covers
- **Start Note**: The lowest MIDI note (pitch) in the output. 36 = C2, 48 = C3, etc.
- **Threshold**: Brightness threshold for extracting notes. Lower values capture more details
- **Auto-detect**: When enabled, automatically detects if the image has a dark or light background and adjusts processing accordingly

## How It Works

1. Image is converted to grayscale
2. Image is resized to match the specified width/height in notes
3. Background type is detected (if auto-detect is enabled)
4. Foreground pixels/edges are extracted using thresholding and edge detection
5. Each extracted pixel becomes a MIDI note at the corresponding pitch and time

## Supported Image Formats

- JPEG/JPG
- PNG
- GIF
- BMP
- And other formats supported by Pillow

## Technical Details

- Built with Flask (Python web framework)
- Image processing using Pillow and NumPy
- MIDI generation using midiutil
- Edge detection for cleaner note extraction

## License

Free to use and modify.
