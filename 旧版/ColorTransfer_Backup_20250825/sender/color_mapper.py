"""
颜色映射模块 - 发送端

将15位编码数据映射为RGB颜色值，确保颜色在可识别范围内。

Example:
    >>> from sender.color_mapper import ColorMapper
    >>> mapper = ColorMapper()
    >>> rgb_color = mapper.map_to_color(0b111110000011111)
"""

from typing import Tuple, List
import numpy as np


class ColorMapper:
    """
    颜色映射器
    
    将15位数据映射为RGB颜色值，使用5-5-5位分布：
    - 高5位 → R通道 (红色)
    - 中5位 → G通道 (绿色)  
    - 低5位 → B通道 (蓝色)
    
    颜色范围设计为65-255，避免过暗或过亮的颜色。
    
    Attributes:
        base_value (int): 颜色基础值（避免过暗）
        max_value (int): 颜色最大值（避免过亮）
        step_size (int): 颜色步长，确保32级灰度
        color_table (List[Tuple[int, int, int]]): 预计算的颜色映射表
    """
    
    def __init__(self, base_value: int = 65, max_value: int = 255):
        """
        初始化颜色映射器
        
        Args:
            base_value: 颜色基础值，默认65（避免纯黑）
            max_value: 颜色最大值，默认255（最大亮度）
        """
        self.base_value = max(0, min(base_value, 255))
        self.max_value = max(0, min(max_value, 255))
        
        # 计算步长：32级灰度（2^5 = 32）
        available_range = self.max_value - self.base_value
        self.step_size = max(1, available_range // 31)  # 31步产生32级
        
        # 预计算颜色映射表
        self.color_table = self._build_color_table()
    
    def _build_color_table(self) -> List[Tuple[int, int, int]]:
        """
        构建预计算的颜色映射表
        
        Returns:
            包含32768种颜色的映射表（2^15 = 32768）
        """
        table = []
        
        for value in range(2**15):
            # 15位分为三个5位组
            r_bits = (value >> 10) & 0x1F  # 高5位
            g_bits = (value >> 5) & 0x1F   # 中5位
            b_bits = value & 0x1F          # 低5位
            
            # 映射到颜色值
            r = self.base_value + r_bits * self.step_size
            g = self.base_value + g_bits * self.step_size
            b = self.base_value + b_bits * self.step_size
            
            # 确保在有效范围内
            r = min(r, self.max_value)
            g = min(g, self.max_value)
            b = min(b, self.max_value)
            
            table.append((r, g, b))
        
        return table
    
    def map_to_color(self, data: int) -> Tuple[int, int, int]:
        """
        将15位数据映射为RGB颜色
        
        Args:
            data: 15位整数数据
            
        Returns:
            RGB颜色元组 (R, G, B)
            
        Raises:
            ValueError: 如果数据超出15位范围
            
        Example:
            >>> mapper = ColorMapper()
            >>> color = mapper.map_to_color(0b111110000011111)
            >>> print(color)  # (251, 65, 251)
        """
        if data < 0 or data >= 2**15:
            raise ValueError("数据必须小于2^15")
        
        return self.color_table[data]
    
    def map_to_colors(self, data_list: List[int]) -> List[Tuple[int, int, int]]:
        """
        批量映射多个15位数据为颜色
        
        Args:
            data_list: 15位整数列表
            
        Returns:
            RGB颜色元组列表
            
        Example:
            >>> mapper = ColorMapper()
            >>> colors = mapper.map_to_colors([0x1234, 0x5678])
            >>> print(len(colors))  # 2
        """
        return [self.map_to_color(data) for data in data_list]
    
    def get_color_info(self, data: int) -> dict:
        """
        获取颜色的详细信息
        
        Args:
            data: 15位整数数据
            
        Returns:
            包含颜色信息的字典
            
        Example:
            >>> mapper = ColorMapper()
            >>> info = mapper.get_color_info(0b111110000011111)
            >>> print(info)
            {'data': 31775, 'rgb': (251, 65, 251), 'hex': '#FB41FB', 'bits': '111110000011111'}
        """
        r, g, b = self.map_to_color(data)
        
        return {
            'data': data,
            'rgb': (r, g, b),
            'hex': f'#{r:02X}{g:02X}{b:02X}',
            'bits': bin(data)[2:].zfill(15),
            'r_bits': bin((data >> 10) & 0x1F)[2:].zfill(5),
            'g_bits': bin((data >> 5) & 0x1F)[2:].zfill(5),
            'b_bits': bin(data & 0x1F)[2:].zfill(5)
        }
    
    def get_color_statistics(self, data_list: List[int]) -> dict:
        """
        获取颜色分布统计
        
        Args:
            data_list: 15位整数列表
            
        Returns:
            颜色统计信息
            
        Example:
            >>> mapper = ColorMapper()
            >>> stats = mapper.get_color_statistics([0x1234, 0x5678])
            >>> print(stats['unique_colors'])  # 2
        """
        colors = self.map_to_colors(data_list)
        
        # 统计信息
        unique_colors = len(set(colors))
        r_values = [c[0] for c in colors]
        g_values = [c[1] for c in colors]
        b_values = [c[2] for c in colors]
        
        return {
            'total_colors': len(colors),
            'unique_colors': unique_colors,
            'r_range': (min(r_values), max(r_values)),
            'g_range': (min(g_values), max(g_values)),
            'b_range': (min(b_values), max(b_values)),
            'average_color': (
                int(np.mean(r_values)),
                int(np.mean(g_values)),
                int(np.mean(b_values))
            )
        }
    
    def validate_color_range(self, color: Tuple[int, int, int]) -> bool:
        """
        验证颜色是否在有效范围内
        
        Args:
            color: RGB颜色元组
            
        Returns:
            是否在有效范围内
            
        Example:
            >>> mapper = ColorMapper()
            >>> mapper.validate_color_range((100, 150, 200))  # True
            >>> mapper.validate_color_range((50, 50, 50))   # False (太暗)
        """
        r, g, b = color
        return (
            self.base_value <= r <= self.max_value and
            self.base_value <= g <= self.max_value and
            self.base_value <= b <= self.max_value
        )
    
    def get_config(self) -> dict:
        """
        获取当前配置信息
        
        Returns:
            配置参数字典
            
        Example:
            >>> mapper = ColorMapper()
            >>> config = mapper.get_config()
            >>> print(config['total_colors'])  # 32768
        """
        return {
            'base_value': self.base_value,
            'max_value': self.max_value,
            'step_size': self.step_size,
            'total_colors': len(self.color_table),
            'bits_per_color': 15,
            'color_levels': 32,
            'color_range': f'{self.base_value}-{self.max_value}'
        }