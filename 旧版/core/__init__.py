"""
核心工具包 - 彩色数据传输系统

提供汉明码编解码、数据打包、颜色转换等基础功能。
"""

__version__ = "1.0.0"
__author__ = "ColorTransfer Team"

from .hamming import HammingCodec
from .data_packer import DataPacker
from .color_utils import ColorUtils

__all__ = ["HammingCodec", "DataPacker", "ColorUtils"]