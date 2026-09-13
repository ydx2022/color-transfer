"""
发送端模块 - 彩色数据传输系统
提供完整的数据编码和传输功能，包含以下子模块：

- ColorSender: 主入口类，协调所有功能
- DataEncoder: 数据编码（11位分组 + 汉明码）
- ColorMapper: 颜色映射（15位 → RGB）
- FrameGenerator: 帧生成（图像帧构建）
- DisplayManager: 显示管理（显示/保存）

完整数据流：
文件 → DataEncoder → ColorMapper → FrameGenerator → DisplayManager

Example:
    >>> from sender import ColorSender
    >>> sender = ColorSender()
    >>> frames = sender.send_file("test.txt")
"""

# 主类
from .color_sender import ColorSender

# 子模块
from .data_encoder import DataEncoder
from .color_mapper import ColorMapper
from .frame_generator import FrameGenerator
from .display_manager import DisplayManager

# 工具类
from ..core.hamming import HammingCodec

__all__ = [
    "ColorSender",
    "DataEncoder", 
    "ColorMapper",
    "FrameGenerator",
    "DisplayManager",
    "HammingCodec"
]