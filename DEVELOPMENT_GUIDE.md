# 彩色数据传输系统 - 详细开发指南

## 项目目标与核心功能
本项目实现通过RGB颜色值传输二进制数据的完整系统，具备以下核心功能：
1. 高效的二进制数据编码与解码
2. 错误检测和纠正能力（使用11,15汉明码）
3. 颜色映射与图像帧生成
4. 完整的发送端与接收端实现

## 系统架构与数据流

### 整体架构
采用简洁的架构设计，避免过度模块化：
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    核心层       │     │    发送端       │     │    接收端       │
│  (core/)       │     │  (sender/)      │     │  (receiver/)    │
│                 │     │                 │     │                 │
│  - hamming.py   │────▶│  - data_encoder │     │  - image_reader │
│  - decoder.py   │     │  - color_mapper │     │  - color_parser │
└─────────────────┘     │  - frame_gen    │     │  - data_decoder │
                        │  - display_mgr  │     └─────────────────┘
                        └─────────────────┘            │
                              │                         │
                              ▼                         ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │    输出图像     │────▶│    输入图像     │
                        └─────────────────┘     └─────────────────┘
```

### 完整数据流
```
文件输入
    ↓
DataEncoder.encode_file()      # 文件→二进制→11位分组→汉明码编码(11→15位)
    ↓
ColorMapper.map_to_colors()    # 15位数据→RGB颜色值
    ↓
FrameGenerator.create_data_frame()  # 颜色值→图像帧
    ↓
DisplayManager.display/save()  # 显示或保存传输帧
```

## 模块开发详细指南

### 1. 核心层开发 (core/)

#### 1.1 汉明码编解码器 (hamming.py)
**开发目标**：实现(11,15)汉明码的编码与解码功能，具备单比特错误检测和纠正能力。

**实现步骤**：
- 定义生成矩阵G和校验矩阵H
- 实现编码函数：11位数据 → 15位汉明码
- 实现解码函数：15位汉明码 → 11位数据（含错误纠正）
- 预计算错误模式映射表以提高解码速度

**关键代码结构**：
```python
class HammingCodec:
    def __init__(self):
        # 初始化生成矩阵和校验矩阵
        self.G = [...]  # 生成矩阵
        self.H = [...]  # 校验矩阵
        self.error_patterns = self._precompute_error_patterns()

    def encode(self, data_bits):
        # 11位数据编码为15位汉明码
        pass

    def decode(self, code_bits):
        # 15位汉明码解码为11位数据，含错误纠正
        pass

    def _precompute_error_patterns(self):
        # 预计算错误模式映射表
        pass
```

#### 1.2 基础编码器 (encoder.py)
**开发目标**：实现数据分块和基本编码功能。

**实现步骤**：
- 实现文件读取和二进制转换
- 将数据分割为11位一组
- 调用HammingCodec进行编码
- 实现批量处理功能提高效率

### 2. 发送端开发 (sender/)

#### 2.1 数据编码器 (data_encoder.py)
**开发目标**：封装核心层编码功能，提供文件到编码数据的完整流程。

**实现步骤**：
- 导入core.HammingCodec
- 实现文件编码方法
- 处理大文件分块编码
- 提供编码统计信息

**关键代码结构**：
```python
from core.hamming import HammingCodec

class DataEncoder:
    def __init__(self):
        self.codec = HammingCodec()

    def encode_file(self, file_path):
        # 读取文件并编码为15位数据块
        pass

    def encode_data(self, data):
        # 编码原始数据
        pass
```

#### 2.2 颜色映射器 (color_mapper.py)
**开发目标**：将15位数据映射为RGB颜色值。

**实现步骤**：
- 定义颜色映射策略（前5位→R，中间5位→G，后5位→B）
- 预计算颜色映射表提高速度
- 实现数据到颜色的映射函数

#### 2.3 帧生成器 (frame_generator.py)
**开发目标**：将颜色数据转换为图像帧。

**实现步骤**：
- 设计帧结构（同步图案、数据区域、校准条）
- 实现图像帧构建功能
- 优化内存使用（缓冲区复用）

#### 2.4 显示管理器 (display_manager.py)
**开发目标**：负责显示和保存生成的图像帧。

**实现步骤**：
- 使用OpenCV或PIL显示图像
- 实现图像保存功能
- 提供帧序列管理

#### 2.5 发送端主类 (color_sender.py)
**开发目标**：整合发送端所有功能，提供简洁API。

**实现步骤**：
- 集成DataEncoder、ColorMapper、FrameGenerator和DisplayManager
- 提供文件发送的完整流程
- 实现配置管理
- 提供状态查询和统计功能

**关键代码结构**：
```python
from sender.data_encoder import DataEncoder
from sender.color_mapper import ColorMapper
from sender.frame_generator import FrameGenerator
from sender.display_manager import DisplayManager

class ColorSender:
    def __init__(self, config=None):
        self.encoder = DataEncoder()
        self.mapper = ColorMapper()
        self.frame_gen = FrameGenerator()
        self.display = DisplayManager()
        self.config = config or {}

    def send_file(self, file_path):
        # 完整的文件发送流程
        encoded_data = self.encoder.encode_file(file_path)
        color_data = self.mapper.map_to_colors(encoded_data)
        frames = self.frame_gen.create_frames(color_data)
        self.display.show_frames(frames)
        return frames
```

### 3. 接收端开发 (receiver/)
（待发送端完成后开发）

### 4. 主程序设计 (main.py)
**开发目标**：提供系统入口，演示完整功能。

**实现步骤**：
- 解析命令行参数
- 初始化ColorSender
- 实现文件传输演示
- 提供简单的用户交互

**参考代码结构**：
```python
import argparse
from sender.color_sender import ColorSender

def main():
    parser = argparse.ArgumentParser(description='彩色数据传输系统')
    parser.add_argument('file', help='要传输的文件路径')
    parser.add_argument('--config', help='配置文件路径', default='config/config.json')
    parser.add_argument('--output', help='输出目录', default='output/sender_output')
    args = parser.parse_args()

    # 初始化发送端
    sender = ColorSender(config=args.config)

    # 发送文件
    print(f'正在传输文件: {args.file}')
    frames = sender.send_file(args.file)

    # 保存结果
    sender.save_frames(frames, args.output)
    print(f'传输完成，生成了{len(frames)}个帧，保存至{args.output}')

if __name__ == '__main__':
    main()
```

## 开发进度建议

### 第一阶段：核心功能 (1-2周)
- 完成汉明码编解码器 (hamming.py)
- 实现基础数据编码器 (encoder.py)
- 编写核心功能测试

### 第二阶段：发送端功能 (2-3周)
- 实现数据编码器 (data_encoder.py)
- 完成颜色映射器 (color_mapper.py)
- 实现帧生成器 (frame_generator.py)
- 完成显示管理器 (display_manager.py)
- 整合发送端主类 (color_sender.py)

### 第三阶段：系统集成与测试 (1-2周)
- 编写主程序 (main.py)
- 实现配置文件 (config.json)
- 进行端到端测试
- 优化性能和错误处理

### 第四阶段：接收端开发 (2-3周)
- 实现图像读取器
- 完成颜色解析器
- 实现数据解码器
- 整合接收端主类

## 测试建议
- 为每个模块编写单元测试
- 使用小文件进行集成测试
- 测试不同类型文件的传输效果
- 测试错误检测和纠正功能

## 优化建议
1. **性能优化**:
   - 预计算查找表减少实时计算
   - 使用NumPy进行批量数据处理
   - 实现内存池复用图像缓冲区

2. **可靠性优化**:
   - 添加详细的错误处理
   - 实现校验和验证
   - 添加重试机制

希望这份开发指南能帮助你清晰地了解项目的实现细节和开发顺序。按照这个计划，你可以每天投入30分钟，逐步完成各个模块的开发。如果在开发过程中遇到问题或需要进一步的指导，请随时告诉我。