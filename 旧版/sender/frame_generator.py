"""
帧生成模块 - 发送端

将RGB颜色数据组织成完整的传输图像帧，包含同步图案、校准条和数据区域。

Example:
    >>> from sender.frame_generator import FrameGenerator
    >>> generator = FrameGenerator()
    >>> frame = generator.create_data_frame(colors)
"""

import numpy as np
import cv2
from typing import List, Tuple, Optional


class FrameGenerator:
    """
    图像帧生成器
    
    创建标准化的传输图像帧，包含：
    1. 同步图案（四角定位）
    2. 校准色条（颜色校准）
    3. 数据区域（颜色编码数据）
    
    Attributes:
        screen_width (int): 屏幕宽度（像素）
        screen_height (int): 屏幕高度（像素）
        block_size (int): 颜色块尺寸（像素）
        grid_width (int): 网格宽度（色块数）
        grid_height (int): 网格高度（色块数）
    """
    
    def __init__(self, screen_width: int = 1600, screen_height: int = 900, block_size: int = 20):
        """
        初始化帧生成器
        
        Args:
            screen_width: 屏幕宽度，默认1600像素
            screen_height: 屏幕高度，默认900像素
            block_size: 颜色块尺寸，默认20像素
        """
        self.screen_width = screen_width
        self.screen_height = screen_height
        self.block_size = block_size
        
        # 计算网格尺寸
        self.grid_width = screen_width // block_size
        self.grid_height = screen_height // block_size
        
        # 验证网格尺寸
        if self.grid_width * self.grid_height < 100:  # 至少100个色块
            raise ValueError("网格尺寸过小，无法容纳数据")
    
    def _create_sync_pattern(self, position: str) -> np.ndarray:
        """
        创建同步图案
        
        Args:
            position: 位置 ('top_left', 'top_right', 'bottom_left', 'bottom_right')
            
        Returns:
            3x3色块的同步图案
        """
        size = self.block_size * 3
        pattern = np.zeros((size, size, 3), dtype=np.uint8)
        
        # 黑白棋盘格图案
        colors = [(0, 0, 0), (255, 255, 255)]  # 黑、白
        
        for i in range(3):
            for j in range(3):
                color_idx = (i + j) % 2
                color = colors[color_idx]
                
                y1, y2 = i * self.block_size, (i + 1) * self.block_size
                x1, x2 = j * self.block_size, (j + 1) * self.block_size
                
                pattern[y1:y2, x1:x2] = color
        
        return pattern
    
    def _create_calibration_bar(self) -> np.ndarray:
        """
        创建校准色条
        
        Returns:
            校准色条图像（高度=block_size）
        """
        # 色条高度为1个block_size
        height = self.block_size
        
        # 计算可用宽度（避开同步图案）
        usable_width = self.screen_width - 6 * self.block_size  # 左右各3个block
        
        cal_bar = np.zeros((height, usable_width, 3), dtype=np.uint8)
        
        # 标准校准颜色（8色）
        cal_colors = [
            (255, 0, 0),      # 红
            (0, 255, 0),      # 绿
            (0, 0, 255),      # 蓝
            (255, 255, 0),    # 黄
            (255, 0, 255),    # 品红
            (0, 255, 255),    # 青
            (255, 255, 255),  # 白
            (128, 128, 128)   # 灰
        ]
        
        # 计算每个颜色的宽度
        color_width = max(1, usable_width // len(cal_colors))
        
        for i, color in enumerate(cal_colors):
            x_start = i * color_width
            x_end = min((i + 1) * color_width, usable_width)
            
            if x_start < usable_width:
                cal_bar[:, x_start:x_end] = color
        
        return cal_bar
    
    def _create_data_grid(self, colors: List[Tuple[int, int, int]], 
                         start_pos: Tuple[int, int] = (3, 2)) -> np.ndarray:
        """
        创建数据网格
        
        Args:
            colors: RGB颜色列表
            start_pos: 起始位置 (x, y) 以block为单位
            
        Returns:
            数据网格图像
        """
        # 计算数据区域的起始位置
        start_x, start_y = start_pos
        
        # 计算最大可容纳的颜色数
        max_cols = self.grid_width - start_x
        max_rows = self.grid_height - start_y - 1  # 留出校准条空间
        max_colors = max_cols * max_rows
        
        # 创建数据网格
        data_grid = np.zeros((
            max_rows * self.block_size,
            max_cols * self.block_size,
            3
        ), dtype=np.uint8)
        
        # 填充颜色数据
        for i, color in enumerate(colors[:max_colors]):
            if i >= max_colors:
                break
            
            row = i // max_cols
            col = i % max_cols
            
            y_start = row * self.block_size
            y_end = (row + 1) * self.block_size
            x_start = col * self.block_size
            x_end = (col + 1) * self.block_size
            
            data_grid[y_start:y_end, x_start:x_end] = color
        
        return data_grid
    
    def create_data_frame(self, colors: List[Tuple[int, int, int]], 
                         page_info: Optional[dict] = None) -> np.ndarray:
        """
        创建完整的数据帧
        
        Args:
            colors: RGB颜色数据列表
            page_info: 页信息字典，包含页码和总页数
            
        Returns:
            完整的传输图像帧
            
        Example:
            >>> generator = FrameGenerator()
            >>> colors = [(255, 0, 0), (0, 255, 0)]
            >>> frame = generator.create_data_frame(colors)
            >>> print(frame.shape)  # (900, 1600, 3)
        """
        # 创建黑色背景
        frame = np.zeros((self.screen_height, self.screen_width, 3), dtype=np.uint8)
        
        # 添加同步图案到四角
        sync_patterns = {
            'top_left': (0, 0),
            'top_right': (self.screen_width - 3 * self.block_size, 0),
            'bottom_left': (0, self.screen_height - 3 * self.block_size),
            'bottom_right': (self.screen_width - 3 * self.block_size, 
                           self.screen_height - 3 * self.block_size)
        }
        
        for pos, (x, y) in sync_patterns.items():
            pattern = self._create_sync_pattern(pos)
            h, w = pattern.shape[:2]
            frame[y:y+h, x:x+w] = pattern
        
        # 添加校准色条（顶部）
        cal_bar = self._create_calibration_bar()
        cal_y = 3 * self.block_size  # 避开顶部同步图案
        cal_x = 3 * self.block_size  # 避开左侧同步图案
        
        h, w = cal_bar.shape[:2]
        if cal_x + w <= self.screen_width:
            frame[cal_y:cal_y+h, cal_x:cal_x+w] = cal_bar
        
        # 添加数据区域
        data_start_y = 4 * self.block_size  # 校准条下方
        data_start_x = 3 * self.block_size  # 避开同步图案
        
        data_grid = self._create_data_grid(colors, (data_start_x // self.block_size, 
                                                   data_start_y // self.block_size))
        
        h, w = data_grid.shape[:2]
        if data_start_y + h <= self.screen_height and data_start_x + w <= self.screen_width:
            frame[data_start_y:data_start_y+h, data_start_x:data_start_x+w] = data_grid
        
        # 添加页码信息（如果有）
        if page_info:
            self._add_page_info(frame, page_info)
        
        return frame
    
    def _add_page_info(self, frame: np.ndarray, page_info: dict):
        """
        添加页码信息到图像
        
        Args:
            frame: 目标图像帧
            page_info: 页信息字典
        """
        if not page_info:
            return
        
        page_num = page_info.get('page', 0)
        total_pages = page_info.get('total', 1)
        
        # 在右下角添加页码文本
        text = f"Page {page_num + 1}/{total_pages}"
        
        # 使用OpenCV添加文本
        cv2.putText(frame, text, 
                   (self.screen_width - 150, self.screen_height - 20),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    
    def get_frame_capacity(self) -> int:
        """
        获取单帧最大容量
        
        Returns:
            单帧可容纳的颜色数
        """
        # 计算数据区域尺寸
        data_start_x = 3 * self.block_size
        data_start_y = 4 * self.block_size
        
        data_cols = (self.screen_width - data_start_x) // self.block_size
        data_rows = (self.screen_height - data_start_y) // self.block_size
        
        return data_cols * data_rows
    
    def get_frame_info(self) -> dict:
        """
        获取帧信息
        
        Returns:
            帧配置信息字典
            
        Example:
            >>> generator = FrameGenerator()
            >>> info = generator.get_frame_info()
            >>> print(info['capacity'])  # 例如: 2856
        """
        return {
            'screen_size': (self.screen_width, self.screen_height),
            'block_size': self.block_size,
            'grid_size': (self.grid_width, self.grid_height),
            'capacity': self.get_frame_capacity(),
            'sync_patterns': 4,  # 四角同步图案
            'calibration_bar': True,
            'usable_area': (
                self.screen_width - 6 * self.block_size,
                self.screen_height - 4 * self.block_size
            )
        }