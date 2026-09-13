#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
发送端核心模块 - 彩色数据传输系统

负责将二进制数据编码为RGB颜色值并生成可视化图像帧。
这是发送端的主入口类，协调各个子模块完成完整的数据编码流程。

完整数据流：
文件 → DataEncoder(11位分组+汉明码) → ColorMapper(15位→RGB) → 
FrameGenerator(图像帧) → DisplayManager(显示)

Example:
    >>> from sender.color_sender import ColorSender
    >>> sender = ColorSender()
    >>> frames = sender.send_file("test.txt")
    >>> print(f"生成了{len(frames)}个传输帧")
"""

import numpy as np
import cv2
import json
import os
from typing import List, Tuple, Optional

from .data_encoder import DataEncoder
from .color_mapper import ColorMapper
from .frame_generator import FrameGenerator
from .display_manager import DisplayManager

class ColorSender:
    """
    彩色数据发送端
    将二进制数据转换为RGB颜色值并生成图像帧
    """
    
    def __init__(self, config_path: str = "config/config.json"):
        """
        初始化发送端
        
        Args:
            config_path: 配置文件路径
        """
        self.config_path = config_path
        self.config = self._load_config()
        
        # 基础配置
        self.screen_width = self.config['hardware']['sender']['resolution'][0]
        self.screen_height = self.config['hardware']['sender']['resolution'][1]
        self.block_size = self.config['data_transfer']['block_dim']
        
        # 颜色映射配置
        self.color_mapping = self.config['color_mapping']
        
        # 数据传输配置
        self.data_config = self.config['data_transfer']
        
        # 计算网格尺寸
        self.grid_width = self.screen_width // self.block_size
        self.grid_height = self.screen_height // self.block_size
        
        print(f"✅ 发送端初始化完成")
        print(f"📱 屏幕分辨率: {self.screen_width}x{self.screen_height}")
        print(f"🔲 色块尺寸: {self.block_size}px")
        print(f"📊 网格大小: {self.grid_width}x{self.grid_height}")
    
    def _load_config(self) -> dict:
        """加载配置文件"""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            print(f"⚠️ 配置文件未找到，使用默认配置")
            return self._get_default_config()
        except json.JSONDecodeError as e:
            print(f"❌ 配置文件格式错误: {e}")
            raise
    
    def _get_default_config(self) -> dict:
        """获取默认配置"""
        return {
            "hardware": {
                "sender": {
                    "resolution": [1920, 1080]
                }
            },
            "color_mapping": {
                "base_value": 65,
                "max_value": 255,
                "step": 6
            },
            "data_transfer": {
                "block_dim": 20,
                "sync_pattern": [255, 255, 255],
                "calibration_blocks": 8
            }
        }
    
    def encode_data(self, data: bytes) -> List[int]:
        """
        将二进制数据编码为15位整数
        
        Args:
            data: 输入的二进制数据
            
        Returns:
            15位整数列表
        """
        encoded = []
        
        # 每2字节（16位）编码为15位
        for i in range(0, len(data), 2):
            if i + 1 < len(data):
                # 合并2字节为16位，然后取15位
                value = (data[i] << 8) | data[i + 1]
                encoded.append(value & 0x7FFF)  # 确保15位
            else:
                # 处理剩余字节
                value = data[i] << 7
                encoded.append(value & 0x7FFF)
        
        return encoded
    
    def data_to_colors(self, encoded_data: List[int]) -> List[Tuple[int, int, int]]:
        """
        将15位数据映射为RGB颜色值
        
        Args:
            encoded_data: 15位整数列表
            
        Returns:
            RGB颜色元组列表 [(r, g, b), ...]
        """
        colors = []
        
        for value in encoded_data:
            # 15位数据分为三个5位组
            r_bits = (value >> 10) & 0x1F  # 高5位 -> R通道
            g_bits = (value >> 5) & 0x1F   # 中5位 -> G通道
            b_bits = value & 0x1F          # 低5位 -> B通道
            
            # 映射到颜色值范围（避免太暗或太亮的颜色）
            base = self.color_mapping.get('base_value', 65)
            step = self.color_mapping.get('step', 6)
            
            r = base + r_bits * step
            g = base + g_bits * step
            b = base + b_bits * step
            
            # 确保在有效范围内
            r = max(base, min(r, 255))
            g = max(base, min(g, 255))
            b = max(base, min(b, 255))
            
            colors.append((r, g, b))
        
        return colors
    
    def create_sync_pattern(self, position: str) -> np.ndarray:
        """
        创建同步图案
        
        Args:
            position: 位置 ('top_left', 'top_right', 'bottom_left', 'bottom_right')
            
        Returns:
            同步图案图像
        """
        size = self.block_size * 3
        pattern = np.zeros((size, size, 3), dtype=np.uint8)
        
        # 简单的黑白棋盘格图案
        for i in range(3):
            for j in range(3):
                color = 255 if (i + j) % 2 == 0 else 0
                x1, y1 = j * self.block_size, i * self.block_size
                x2, y2 = x1 + self.block_size, y1 + self.block_size
                pattern[y1:y2, x1:x2] = [color, color, color]
        
        return pattern
    
    def create_calibration_bar(self) -> np.ndarray:
        """
        创建校准色条
        
        Returns:
            校准色条图像
        """
        height = self.block_size
        width = self.screen_width - 6 * self.block_size  # 减去同步图案空间
        
        cal_bar = np.zeros((height, width, 3), dtype=np.uint8)
        
        # 创建8色校准条
        colors = [
            (255, 0, 0),    # 红
            (0, 255, 0),    # 绿
            (0, 0, 255),    # 蓝
            (255, 255, 0),  # 黄
            (255, 0, 255),  # 品红
            (0, 255, 255),  # 青
            (255, 255, 255), # 白
            (128, 128, 128)  # 灰
        ]
        
        block_width = width // len(colors)
        for i, color in enumerate(colors):
            x1 = i * block_width
            x2 = (i + 1) * block_width
            cal_bar[:, x1:x2] = color
        
        return cal_bar
    
    def create_data_frame(self, data: bytes, page_num: int = 0, total_pages: int = 1) -> np.ndarray:
        """
        创建完整的数据帧
        
        Args:
            data: 要发送的二进制数据
            page_num: 当前页码
            total_pages: 总页数
            
        Returns:
            完整的图像帧
        """
        # 创建空白帧
        frame = np.zeros((self.screen_height, self.screen_width, 3), dtype=np.uint8)
        
        # 编码数据
        encoded_data = self.encode_data(data)
        colors = self.data_to_colors(encoded_data)
        
        # 添加同步图案到四个角
        sync_pattern = self.create_sync_pattern('top_left')
        h, w = sync_pattern.shape[:2]
        frame[0:h, 0:w] = sync_pattern
        
        # 其他三个角的同步图案
        frame[0:h, -w:] = sync_pattern
        frame[-h:, 0:w] = sync_pattern
        frame[-h:, -w:] = sync_pattern
        
        # 添加校准色条
        cal_bar = self.create_calibration_bar()
        cal_h, cal_w = cal_bar.shape[:2]
        frame[self.block_size:self.block_size+cal_h, 
              3*self.block_size:3*self.block_size+cal_w] = cal_bar
        
        # 填充数据色块
        data_start_x = 3 * self.block_size
        data_start_y = 3 * self.block_size
        
        idx = 0
        for y in range(data_start_y, self.screen_height - 3*self.block_size, self.block_size):
            for x in range(data_start_x, self.screen_width - 3*self.block_size, self.block_size):
                if idx < len(colors):
                    color = colors[idx]
                    frame[y:y+self.block_size, x:x+self.block_size] = color
                    idx += 1
                else:
                    break
        
        return frame
    
    def send_file(self, file_path: str, output_dir: str = "output") -> List[str]:
        """
        发送文件 - 将文件转换为图像帧序列
        
        Args:
            file_path: 要发送的文件路径
            output_dir: 输出目录
            
        Returns:
            生成的图像文件路径列表
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"文件未找到: {file_path}")
        
        # 创建输出目录
        os.makedirs(output_dir, exist_ok=True)
        
        # 读取文件数据
        with open(file_path, 'rb') as f:
            file_data = f.read()
        
        # 计算每帧可承载的数据量
        data_blocks_per_frame = ((self.grid_width - 6) * (self.grid_height - 6)) // 2
        bytes_per_frame = data_blocks_per_frame * 2  # 每15位约2字节
        
        # 计算总页数
        total_pages = (len(file_data) + bytes_per_frame - 1) // bytes_per_frame
        
        print(f"📁 文件: {os.path.basename(file_path)}")
        print(f"📊 文件大小: {len(file_data)} 字节")
        print(f"📦 每帧数据: {bytes_per_frame} 字节")
        print(f"📄 总页数: {total_pages}")
        
        generated_files = []
        
        for page_num in range(total_pages):
            start_idx = page_num * bytes_per_frame
            end_idx = min((page_num + 1) * bytes_per_frame, len(file_data))
            page_data = file_data[start_idx:end_idx]
            
            # 创建数据帧
            frame = self.create_data_frame(page_data, page_num, total_pages)
            
            # 保存图像
            output_path = os.path.join(output_dir, f"frame_{page_num:03d}.png")
            cv2.imwrite(output_path, frame)
            generated_files.append(output_path)
            
            print(f"✅ 生成: {output_path}")
        
        return generated_files
    
    def preview_frame(self, data: bytes = b"Hello, Color Transfer!") -> None:
        """
        预览单个数据帧
        
        Args:
            data: 要显示的数据
        """
        frame = self.create_data_frame(data)
        
        # 调整显示大小
        display_width = 800
        display_height = int(self.screen_height * display_width / self.screen_width)
        display_frame = cv2.resize(frame, (display_width, display_height))
        
        cv2.imshow("Color Transfer Preview", display_frame)
        cv2.waitKey(0)
        cv2.destroyAllWindows()
    
    def get_frame_info(self) -> dict:
        """
        获取当前配置下的帧信息
        
        Returns:
            帧信息字典
        """
        data_blocks_per_frame = ((self.grid_width - 6) * (self.grid_height - 6)) // 2
        bytes_per_frame = data_blocks_per_frame * 2
        
        return {
            "screen_resolution": [self.screen_width, self.screen_height],
            "block_size": self.block_size,
            "grid_size": [self.grid_width, self.grid_height],
            "data_blocks_per_frame": data_blocks_per_frame,
            "bytes_per_frame": bytes_per_frame
        }


def main():
    """测试主函数"""
    try:
        # 创建发送端实例
        sender = ColorSender()
        
        # 显示配置信息
        info = sender.get_frame_info()
        print("\n📊 配置信息:")
        for key, value in info.items():
            print(f"  {key}: {value}")
        
        # 预览示例
        print("\n🎯 预览示例帧...")
        sender.preview_frame(b"Hello, Color Transfer System!")
        
    except Exception as e:
        print(f"❌ 错误: {e}")


if __name__ == "__main__":
    main()