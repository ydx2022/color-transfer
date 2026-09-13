# 发送端模块 (Sender)

## 📋 功能概述

发送端模块负责将二进制数据编码为RGB颜色值，并生成包含这些颜色的可视化图像帧，用于通过屏幕显示传输数据。

## 🚀 快速开始

### 1. 基本使用

```python
from sender import ColorSender

# 创建发送端实例
sender = ColorSender()

# 发送文本数据
frame = sender.create_data_frame(b"Hello World")

# 发送文件
frames = sender.send_file("data.txt", "output")
```

### 2. 命令行使用

```bash
# 运行示例
python -m sender.example_usage

# 直接运行模块
python -m sender.color_sender
```

## 📊 配置参数

### 屏幕分辨率
- 默认: 1600x900
- 可在 `config/config.json` 中修改

### 色块尺寸
- 默认: 20x20 像素
- 每帧可容纳约 2,800 个数据色块

### 颜色映射
- 15位数据 → RGB颜色
- 每通道5位，共32个色阶
- 颜色范围: 65-255 (避免太暗的颜色)

## 🔧 核心功能

### 1. 数据编码
- `encode_data(data: bytes) -> List[int]`
- 将二进制数据编码为15位整数

### 2. 颜色映射
- `data_to_colors(encoded_data: List[int]) -> List[Tuple[int, int, int]]`
- 将15位数据映射为RGB颜色值

### 3. 帧生成
- `create_data_frame(data: bytes, page_num=0, total_pages=1) -> np.ndarray`
- 生成包含同步图案、校准色条和数据色块的完整图像帧

### 4. 文件发送
- `send_file(file_path: str, output_dir: str) -> List[str]`
- 将文件转换为图像帧序列

## 🎯 帧结构

```
┌─────────────────────────────────────────────┐
│ 同步图案  校准色条  同步图案                  │
├─────────────────────────────────────────────┤
│                                             │
│  同步图                                     │
│  案    数据色块区域                        │
│                                             │
│  同步图                                     │
│  案                                         │
│                                             │
├─────────────────────────────────────────────┤
│ 同步图案  页码信息  同步图案                  │
└─────────────────────────────────────────────┘
```

## 📈 性能参数

| 参数 | 数值 |
|------|------|
| 屏幕分辨率 | 1600x900 |
| 色块尺寸 | 20x20 px |
| 每帧数据色块 | ~2,800 |
| 每帧数据量 | ~5,600 字节 |
| 颜色深度 | 24位 RGB |
| 传输效率 | ~5.5 KB/帧 |

## 🎨 颜色映射算法

15位数据分解为：
- 高5位 → R通道 (0-31 → 65-255)
- 中5位 → G通道 (0-31 → 65-255)
- 低5位 → B通道 (0-31 → 65-255)

## 🛠️ 使用示例

### 发送文本消息

```python
from sender import ColorSender

sender = ColorSender()
text = "Hello, Color Transfer System!"
frame = sender.create_data_frame(text.encode('utf-8'))

# 显示或保存
import cv2
cv2.imwrite('message.png', frame)
```

### 发送文件

```python
sender = ColorSender()
frames = sender.send_file('document.pdf', 'output_frames')
print(f'生成了 {len(frames)} 个数据帧')
```

### 预览功能

```python
sender = ColorSender()
sender.preview_frame(b'Test data 12345')
```

## 📁 文件结构

```
sender/
├── __init__.py         # 模块初始化
├── color_sender.py     # 核心发送端类
├── example_usage.py    # 使用示例
└── README.md          # 本文档
```

## 🔍 调试和测试

### 运行测试

```bash
# 运行完整示例
python -m sender.example_usage

# 测试单个功能
python -c "from sender import ColorSender; ColorSender().preview_frame(b'test')"
```

### 输出文件

运行示例后会生成：
- `sender/output/example_text.png` - 文本数据示例帧
- `sender/output/test_data.txt` - 测试文件
- `sender/output/frame_*.png` - 文件分割后的数据帧

## ⚡ 性能优化建议

1. **调整色块尺寸**：减小色块尺寸可提高数据密度
2. **优化颜色映射**：调整颜色范围和步长
3. **压缩数据**：在编码前压缩原始数据
4. **并行处理**：多线程处理大文件

## 🔄 下一步计划

- [ ] 添加数据压缩支持
- [ ] 实现错误检测和纠正码
- [ ] 支持动态调整帧大小
- [ ] 添加批量处理功能