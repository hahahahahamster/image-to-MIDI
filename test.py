from PIL import Image
from midiutil import MIDIFile

# 1. 配置参数
IMAGE_PATH = 'D:\midi\s-l1200 (2).jpg'  # 换成你的文件名
MIDI_FILENAME = "heart_shape.mid"
WIDTH_NOTES = 100       # 歌曲长度（X轴）：水平方向压缩成多少个音符宽
HEIGHT_NOTES = 60       # 音域跨度（Y轴）：垂直方向对应多少个半音
START_NOTE = 36         # 最低音（36是C2，调这个控制整体音高）
THRESHOLD = 100         # 亮度阈值（0-255），越小捕捉的细节越多

# 2. 处理图片
img = Image.open(IMAGE_PATH).convert('L') # 转灰度
# 强制缩放图片以适应钢琴卷帘的网格 (时间 x 音高)
img = img.resize((WIDTH_NOTES, HEIGHT_NOTES))
pixels = list(img.getdata())
width, height = img.size

# 3. 创建 MIDI 对象
midi = MIDIFile(1)  # 1个轨道
track = 0
time = 0
midi.addTrackName(track, time, "Image Track")
midi.addTempo(track, time, 120)

# 4. 遍历像素生成音符
# 注意：Pillow的坐标原点在左上角，但MIDI音高是下低上高，所以Y轴要反转
for y in range(height):
    for x in range(width):
        # 获取当前像素亮度
        pixel_val = pixels[y * width + x]
        
        # 如果这个像素够亮（是白色线条），就生成一个音符
        # 这里假设你的图是黑底白线。如果是白底黑线，改成 if pixel_val < THRESHOLD
        if pixel_val > THRESHOLD: 
            pitch = START_NOTE + (height - y - 1)  # 反转Y轴
            duration = 1  # 每个像素对应1拍（或更短）
            volume = 100
            
            # 添加音符 (track, channel, pitch, time, duration, volume)
            midi.addNote(track, 0, pitch, x, duration, volume)

# 5. 保存文件
with open(MIDI_FILENAME, "wb") as output_file:
    midi.writeFile(output_file)

print(f"转换完成！请把 {MIDI_FILENAME} 拖入 FL Studio 的钢琴卷帘中。")