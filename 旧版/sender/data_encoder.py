"""
数据编码模块 - 发送端

负责将文件数据转换为11位分组，添加汉明码保护，最终编码为15位数据。

Example:
    >>> from sender.data_encoder import DataEncoder
    >>> encoder = DataEncoder()
    >>> encoded_data = encoder.encode_file("test.txt")
"""

import os
from typing import List, Tuple, BinaryIO
from core.hamming import HammingCodec


class DataEncoder:
    """
    数据编码器
    
    将二进制数据按指定流程编码：
    1. 读取文件为二进制数据
    2. 分割为11位一组
    3. 每组添加(11,15)汉明码
    4. 输出15位编码数据
    
    Attributes:
        hamming_codec (HammingCodec): 汉明码编解码器实例
        chunk_size (int): 每次处理的字节块大小
    """
    
    def __init__(self, chunk_size: int = 1024):
        """
        初始化数据编码器
        
        Args:
            chunk_size: 内存缓冲区大小（字节），默认1KB
        """
        self.hamming_codec = HammingCodec()
        self.chunk_size = chunk_size
    
    def _bytes_to_bits(self, data: bytes) -> List[int]:
        """
        将字节数据转换为比特列表
        
        Args:
            data: 输入的字节数据
            
        Returns:
            比特列表（0或1）
        """
        bits = []
        for byte in data:
            bits.extend([(byte >> i) & 1 for i in range(7, -1, -1)])
        return bits
    
    def _bits_to_int(self, bits: List[int]) -> int:
        """
        将比特列表转换为整数
        
        Args:
            bits: 比特列表
            
        Returns:
            对应的整数值
        """
        return int(''.join(map(str, bits)), 2)
    
    def _group_bits(self, bits: List[int], group_size: int = 11) -> List[int]:
        """
        将比特流按指定大小分组
        
        Args:
            bits: 输入的比特列表
            group_size: 每组比特数，默认11位
            
        Returns:
            分组后的整数列表
        """
        groups = []
        
        for i in range(0, len(bits), group_size):
            group_bits = bits[i:i + group_size]
            
            # 如果不足group_size位，补0
            if len(group_bits) < group_size:
                group_bits.extend([0] * (group_size - len(group_bits)))
            
            # 转换为整数
            value = self._bits_to_int(group_bits)
            groups.append(value)
        
        return groups
    
    def encode_data(self, data: bytes) -> List[int]:
        """
        编码二进制数据
        
        完整流程：二进制 → 11位分组 → 汉明码 → 15位输出
        
        Args:
            data: 输入的二进制数据
            
        Returns:
            15位编码数据列表
            
        Example:
            >>> encoder = DataEncoder()
            >>> data = b"Hello"
            >>> encoded = encoder.encode_data(data)
            >>> print(f"原始{len(data)*8}位 → 编码{len(encoded)*15}位")
        """
        # 步骤1：字节转比特
        bits = self._bytes_to_bits(data)
        
        # 步骤2：11位分组
        groups_11bit = self._group_bits(bits, 11)
        
        # 步骤3：汉明码编码
        encoded_15bit = []
        for group in groups_11bit:
            encoded = self.hamming_codec.encode(group)
            encoded_15bit.append(encoded)
        
        return encoded_15bit
    
    def encode_file(self, file_path: str) -> List[int]:
        """
        编码整个文件
        
        Args:
            file_path: 文件路径
            
        Returns:
            15位编码数据列表
            
        Raises:
            FileNotFoundError: 文件不存在
            IOError: 文件读取错误
            
        Example:
            >>> encoder = DataEncoder()
            >>> encoded = encoder.encode_file("test.txt")
            >>> print(f"文件编码完成，共{len(encoded)}个15位数据")
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"文件不存在: {file_path}")
        
        all_encoded = []
        
        try:
            with open(file_path, 'rb') as f:
                while True:
                    chunk = f.read(self.chunk_size)
                    if not chunk:
                        break
                    
                    encoded_chunk = self.encode_data(chunk)
                    all_encoded.extend(encoded_chunk)
        
        except IOError as e:
            raise IOError(f"文件读取错误: {e}")
        
        return all_encoded
    
    def encode_stream(self, stream: BinaryIO) -> List[int]:
        """
        编码二进制流
        
        Args:
            stream: 二进制输入流
            
        Returns:
            15位编码数据列表
            
        Example:
            >>> import io
            >>> stream = io.BytesIO(b"test data")
            >>> encoder = DataEncoder()
            >>> encoded = encoder.encode_stream(stream)
        """
        all_encoded = []
        
        while True:
            chunk = stream.read(self.chunk_size)
            if not chunk:
                break
            
            encoded_chunk = self.encode_data(chunk)
            all_encoded.extend(encoded_chunk)
        
        return all_encoded
    
    def get_encoding_info(self, data: bytes) -> dict:
        """
        获取编码信息
        
        Args:
            data: 输入的二进制数据
            
        Returns:
            包含编码统计信息的字典
            
        Example:
            >>> encoder = DataEncoder()
            >>> info = encoder.get_encoding_info(b"test")
            >>> print(info)
            {'original_bits': 32, 'encoded_bits': 45, 'groups': 3, 'efficiency': 0.71}
        """
        bits = self._bytes_to_bits(data)
        groups_11bit = self._group_bits(bits, 11)
        encoded_bits = len(groups_11bit) * 15
        
        return {
            'original_bits': len(bits),
            'encoded_bits': encoded_bits,
            'groups': len(groups_11bit),
            'efficiency': len(bits) / encoded_bits if encoded_bits > 0 else 0,
            'redundancy_ratio': 15 / 11  # 15位/11位 ≈ 1.36
        }