from flask import Flask, render_template, request, send_file, jsonify
from PIL import Image
from midiutil import MIDIFile
import io
import os
import numpy as np

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['OUTPUT_FOLDER'] = 'outputs'

# Create folders if they don't exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['OUTPUT_FOLDER'], exist_ok=True)


def detect_background_type(img_array):
    """
    Detect if image has dark or light background.
    - Light bg: most pixels bright (e.g. white + dark pattern).
    - Dark bg:  most pixels dark (e.g. black + bright pattern).
    """
    flat = img_array.flatten()
    med = float(np.median(flat))
    mean = float(np.mean(flat))

    # Fraction of pixels that are bright vs dark
    bright_ratio = np.sum(flat >= 180) / flat.size   # white-ish
    dark_ratio = np.sum(flat <= 80) / flat.size     # black-ish

    # Edge brightness – often reflects background
    edge = np.concatenate([img_array[0, :], img_array[-1, :], img_array[:, 0], img_array[:, -1]])
    edge_mean = float(np.mean(edge))

    # Clearly white background: edges bright, most pixels bright
    if edge_mean >= 180 and bright_ratio >= 0.35:
        return 'light'
    if edge_mean >= 200 or (bright_ratio >= 0.5 and med >= 180):
        return 'light'

    # Clearly black background: edges dark, most pixels dark
    if edge_mean <= 80 and dark_ratio >= 0.35:
        return 'dark'
    if edge_mean <= 60 or (dark_ratio >= 0.5 and med <= 80):
        return 'dark'

    # Gray / mixed: use median and ratios
    if dark_ratio >= 0.4 and med < 100:
        return 'dark'
    if bright_ratio >= 0.4 and med > 150:
        return 'light'
    # Tie-break: whichever side (dark/bright) dominates
    if dark_ratio > bright_ratio + 0.1:
        return 'dark'
    if bright_ratio > dark_ratio + 0.1:
        return 'light'
    return 'light' if med >= 128 else 'dark'


def gaussian_blur(img_array, kernel_size=3):
    """Simple Gaussian blur using convolution"""
    if kernel_size < 3:
        return img_array
    
    # Simple 3x3 Gaussian kernel
    kernel = np.array([[1, 2, 1],
                       [2, 4, 2],
                       [1, 2, 1]]) / 16.0
    
    h, w = img_array.shape
    blurred = np.zeros_like(img_array, dtype=np.float32)
    
    pad = kernel_size // 2
    padded = np.pad(img_array.astype(np.float32), pad, mode='edge')
    
    for i in range(h):
        for j in range(w):
            blurred[i, j] = np.sum(padded[i:i+kernel_size, j:j+kernel_size] * kernel)
    
    return blurred.astype(np.uint8)


def morphological_erosion(mask, kernel_size=2):
    """Morphological erosion to remove small noise"""
    h, w = mask.shape
    eroded = np.zeros_like(mask)
    pad = kernel_size // 2
    padded = np.pad(mask, pad, mode='constant', constant_values=False)
    
    for i in range(h):
        for j in range(w):
            region = padded[i:i+kernel_size, j:j+kernel_size]
            eroded[i, j] = np.all(region) if kernel_size > 1 else mask[i, j]
    
    return eroded


def morphological_dilation(mask, kernel_size=2):
    """Morphological dilation to restore shape"""
    h, w = mask.shape
    dilated = np.zeros_like(mask)
    pad = kernel_size // 2
    padded = np.pad(mask, pad, mode='constant', constant_values=False)
    
    for i in range(h):
        for j in range(w):
            region = padded[i:i+kernel_size, j:j+kernel_size]
            dilated[i, j] = np.any(region)
    
    return dilated


def morphological_opening(mask, kernel_size=2):
    """Morphological opening (erosion followed by dilation) to remove noise"""
    # Erosion: remove small noise
    eroded = morphological_erosion(mask, kernel_size)
    # Dilation: restore shape
    opened = morphological_dilation(eroded, kernel_size)
    return opened


def morphological_closing(mask, kernel_size=2):
    """Morphological closing (dilation followed by erosion) to fill small holes"""
    # Dilation: expand and fill small holes inside shapes
    dilated = morphological_dilation(mask, kernel_size)
    # Erosion: restore boundary
    closed = morphological_erosion(dilated, kernel_size)
    return closed


def sobel_edge_detection(img_array):
    """Sobel edge detection for better edge extraction"""
    h, w = img_array.shape
    
    # Sobel kernels
    sobel_x = np.array([[-1, 0, 1],
                        [-2, 0, 2],
                        [-1, 0, 1]])
    sobel_y = np.array([[-1, -2, -1],
                        [0, 0, 0],
                        [1, 2, 1]])
    
    # Pad image
    padded = np.pad(img_array.astype(np.float32), 1, mode='edge')
    
    grad_x = np.zeros_like(img_array, dtype=np.float32)
    grad_y = np.zeros_like(img_array, dtype=np.float32)
    
    for i in range(h):
        for j in range(w):
            region = padded[i:i+3, j:j+3]
            grad_x[i, j] = np.sum(region * sobel_x)
            grad_y[i, j] = np.sum(region * sobel_y)
    
    edge_magnitude = np.hypot(grad_x, grad_y)
    return edge_magnitude


def extract_main_contours(mask, min_area_ratio=0.01):
    """
    Extract only main contours by filtering small connected components.
    Returns a cleaned mask with only significant contours.
    """
    h, w = mask.shape
    min_area = int(h * w * min_area_ratio)
    
    # Simple connected component labeling (4-connected)
    visited = np.zeros_like(mask, dtype=bool)
    cleaned_mask = np.zeros_like(mask)
    
    def flood_fill(start_y, start_x):
        """Flood fill to find connected component"""
        component = []
        stack = [(start_y, start_x)]
        
        while stack:
            y, x = stack.pop()
            if y < 0 or y >= h or x < 0 or x >= w:
                continue
            if visited[y, x] or not mask[y, x]:
                continue
            
            visited[y, x] = True
            component.append((y, x))
            
            # 4-connected neighbors
            stack.extend([(y-1, x), (y+1, x), (y, x-1), (y, x+1)])
        
        return component
    
    # Find all connected components
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not visited[y, x]:
                component = flood_fill(y, x)
                # Only keep components above minimum area
                if len(component) >= min_area:
                    for cy, cx in component:
                        cleaned_mask[cy, cx] = True
    
    return cleaned_mask


def otsu_threshold(img_array):
    """Otsu's method for optimal threshold selection"""
    hist, bins = np.histogram(img_array.flatten(), bins=256, range=(0, 256))
    hist = hist.astype(np.float32)
    
    # Normalize histogram
    hist /= hist.sum()
    
    # Calculate cumulative sums
    cumsum = np.cumsum(hist)
    cummean = np.cumsum(hist * np.arange(256))
    
    # Calculate between-class variance for all thresholds
    global_mean = cummean[-1]
    between_class_var = np.zeros(256)
    
    for t in range(256):
        w0 = cumsum[t]
        w1 = 1.0 - w0
        if w0 == 0 or w1 == 0:
            continue
        m0 = cummean[t] / w0 if w0 > 0 else 0
        m1 = (global_mean - cummean[t]) / w1 if w1 > 0 else 0
        between_class_var[t] = w0 * w1 * (m0 - m1) ** 2
    
    # Find threshold with maximum between-class variance
    optimal_threshold = np.argmax(between_class_var)
    return optimal_threshold


def adaptive_threshold(img_array, block_size=15, c=10, use_otsu=False):
    """Adaptive threshold for better binarization"""
    h, w = img_array.shape
    
    if use_otsu and h * w < 10000:  # Use Otsu for smaller images
        threshold = otsu_threshold(img_array)
        return img_array > threshold
    
    # Calculate local mean for each pixel
    threshold_map = np.zeros_like(img_array, dtype=np.float32)
    
    half_block = block_size // 2
    padded = np.pad(img_array.astype(np.float32), half_block, mode='edge')
    
    for i in range(h):
        for j in range(w):
            region = padded[i:i+block_size, j:j+block_size]
            local_mean = np.mean(region)
            local_std = np.std(region)
            # Use local mean and std for better adaptation
            threshold_map[i, j] = local_mean - c - local_std * 0.5
    
    return img_array > threshold_map


def process_image_intelligently(img, threshold, auto_detect=True, background=None):
    """
    Extract SOLID filled shapes (not outlines). Handles dark/light/color images.
    background: None = auto, 'light' = white bg (pattern=notes), 'dark' = black bg (pattern=notes).
    """
    # Convert to grayscale if color
    if img.mode != 'L':
        img = img.convert('L')
    
    img_array = np.array(img)
    h, w = img_array.shape
    
    # Step 1: Light blur only for large images
    if h * w > 50000:
        img_array = gaussian_blur(img_array, kernel_size=3)
    
    # Step 2: Background type – user override or auto-detect
    if background in ('light', 'dark'):
        bg_type = background
    elif auto_detect:
        bg_type = detect_background_type(img_array)
    else:
        bg_type = 'dark'
    
    # Step 3: SOLID mask – foreground = the pattern (not the background).
    # - Dark bg: pattern is bright → notes where img is bright (img > threshold).
    # - Light bg: pattern is dark  → notes where img is dark  (img < threshold).
    if auto_detect:
        if bg_type == 'dark':
            block_size = max(3, min(h, w)//15)
            solid_mask = adaptive_threshold(img_array,
                                           block_size=block_size,
                                           c=threshold//4,
                                           use_otsu=(h * w < 50000))
        else:
            # Light bg: we want DARK pixels (pattern). Use original image and keep below threshold.
            # Otsu gives T; pattern = dark = pixels below T → solid_mask = (img_array < T).
            T = otsu_threshold(img_array)
            solid_mask = (img_array < T)
    else:
        if bg_type == 'light':
            solid_mask = img_array < (255 - threshold)
        else:
            solid_mask = img_array > threshold
    
    # Step 4: Morphological CLOSING to fill holes (hollow letters → solid)
    kernel = 2
    solid_mask = morphological_closing(solid_mask, kernel_size=kernel)
    
    # Step 5: Morphological OPENING to remove small noise speckles
    solid_mask = morphological_opening(solid_mask, kernel_size=1)
    
    # Step 6: Remove tiny isolated components (noise), keep main shapes
    min_area_ratio = max(0.001, min(0.008, 40.0 / (h * w)))
    solid_mask = extract_main_contours(solid_mask, min_area_ratio=min_area_ratio)
    
    # Step 7: Ensure notes = pattern, empty = background.
    # If most pixels are True, we're marking background → invert so pattern = notes.
    fill_ratio = np.sum(solid_mask) / solid_mask.size
    if fill_ratio > 0.5:
        solid_mask = np.logical_not(solid_mask)

    return solid_mask


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/convert', methods=['POST'])
def convert_image():
    try:
        # Get parameters from form
        width_notes = int(request.form.get('width_notes', 200))
        height_notes = int(request.form.get('height_notes', 120))
        start_note = int(request.form.get('start_note', 36))
        threshold = int(request.form.get('threshold', 100))
        auto_detect = request.form.get('auto_detect', 'true') == 'true'
        background = request.form.get('background', '').strip().lower()  # '', 'light', 'dark'
        if background not in ('light', 'dark'):
            background = None
        
        # Validate parameters
        if not (1 <= width_notes <= 1000):
            return jsonify({'error': 'Width notes must be between 1 and 1000'}), 400
        if not (1 <= height_notes <= 400):
            return jsonify({'error': 'Height notes must be between 1 and 400'}), 400
        if not (0 <= start_note <= 127):
            return jsonify({'error': 'Start note must be between 0 and 127'}), 400
        if not (0 <= threshold <= 255):
            return jsonify({'error': 'Threshold must be between 0 and 255'}), 400
        
        # Get uploaded file
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
        
        file = request.files['image']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Read and process image
        img = Image.open(io.BytesIO(file.read()))
        original_size = img.size
        
        # Process at higher resolution first for better detail preservation
        # Scale up if original is smaller than target, or process at 2x target resolution
        process_width = max(width_notes * 2, original_size[0])
        process_height = max(height_notes * 2, original_size[1])
        
        # Limit processing resolution to avoid memory issues (max 2000x2000)
        max_process_size = 2000
        if process_width > max_process_size or process_height > max_process_size:
            scale = min(max_process_size / process_width, max_process_size / process_height)
            process_width = int(process_width * scale)
            process_height = int(process_height * scale)
        
        # Resize to processing resolution using high-quality interpolation
        if img.size != (process_width, process_height):
            img_processed = img.resize((process_width, process_height), Image.Resampling.LANCZOS)
        else:
            img_processed = img
        
        # Intelligently process image at higher resolution
        mask = process_image_intelligently(img_processed, threshold, auto_detect, background=background)
        
        # Downsample mask to target resolution using high-quality interpolation
        if mask.shape != (height_notes, width_notes):
            mask_img = Image.fromarray((mask * 255).astype(np.uint8))
            mask_img = mask_img.resize((width_notes, height_notes), Image.Resampling.LANCZOS)
            mask = np.array(mask_img) > 127
        
        # Create MIDI file
        midi = MIDIFile(1)
        track = 0
        time = 0
        midi.addTrackName(track, time, "Image Track")
        midi.addTempo(track, time, 120)
        
        # Generate notes from mask
        height, width = mask.shape
        note_count = 0
        
        # Calculate pitch range and ensure it fits within MIDI range (0-127)
        max_possible_pitch = start_note + height - 1
        if max_possible_pitch > 127:
            # Scale down the pitch range to fit within MIDI range
            # Calculate scale factor to map [start_note, start_note+height-1] to [start_note, 127]
            available_range = 127 - start_note + 1  # Available MIDI notes from start_note to 127
            scale_factor = available_range / height
        else:
            scale_factor = 1.0
        
        for y in range(height):
            for x in range(width):
                if mask[y, x]:
                    # Reverse Y axis (PIL origin is top-left, MIDI pitch is bottom-low)
                    # Scale pitch to fit within MIDI range if needed
                    if scale_factor < 1.0:
                        # Map y position (0 to height-1) to pitch range
                        relative_y = height - y - 1  # Reverse: bottom becomes low pitch
                        pitch = start_note + int(relative_y * scale_factor)
                    else:
                        pitch = start_note + (height - y - 1)
                    
                    # Clamp pitch to valid MIDI range (0-127) as safety check
                    pitch = max(0, min(127, int(pitch)))
                    
                    duration = 1
                    volume = 100
                    
                    midi.addNote(track, 0, pitch, x, duration, volume)
                    note_count += 1
        
        # Save MIDI to memory
        midi_buffer = io.BytesIO()
        midi.writeFile(midi_buffer)
        midi_buffer.seek(0)
        
        return send_file(
            midi_buffer,
            mimetype='audio/midi',
            as_attachment=True,
            download_name='image_to_midi.mid'
        )
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)
