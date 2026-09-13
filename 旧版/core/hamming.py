"""
汉明码编解码模块

提供(11,15)汉明码的编码和解码功能，用于错误检测和纠正。

Example:
    >>> from core.hamming import HammingCodec
    >>> codec = HammingCodec()
    >>> encoded = codec.encode(0b10101010101)
    >>> decoded = codec.decode(encoded)
"""

from typing import List, Tuple


class HammingCodec:
    """
    (11,15)汉明码编解码器
    
    将11位数据编码为15位汉明码，可检测并纠正单比特错误。
    
    Attributes:
        G (List[List[int]]): 生成矩阵
        H (List[List[int]]): 校验矩阵
        syndrome_map (dict): 错误模式映射表
    """
    
    def __init__(self):
        """初始化汉明码编解码器"""
        # 生成矩阵 G = [I11 | P] 11x15
        self.G = self._build_generator_matrix()
        
        # 校验矩阵 H = [P^T | I4] 4x15
        self.H = self._build_parity_matrix()
        
        # 预计算错误模式映射表
        self.syndrome_map = self._build_syndrome_map()
    
    def _build_generator_matrix(self) -> List[List[int]]:
        """
        构建生成矩阵
        
        Returns:
            11x15的生成矩阵
        """
        # 11x4的P矩阵（系统码形式）
        P = [
            [1, 1, 0, 1],
            [1, 0, 1, 1],
            [0, 1, 1, 1],
            [1, 1, 1, 0],
            [1, 1, 1, 1],
            [1, 0, 0, 1],
            [0, 1, 0, 1],
            [0, 0, 1, 1],
            [1, 1, 0, 0],
            [1, 0, 1, 0],
            [0, 1, 1, 0]
        ]
        
        # 构建完整的生成矩阵 [I11 | P]
        G = []
        for i in range(11):
            row = [0] * 15
            row[i] = 1  # 单位矩阵部分
            for j in range(4):
                row[11 + j] = P[i][j]
            G.append(row)
        
        return G
    
    def _build_parity_matrix(self) -> List[List[int]]:
        """
        构建校验矩阵
        
        Returns:
            4x15的校验矩阵
        """
        # P矩阵的转置
        P_T = [
            [1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 0],
            [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1],
            [0, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1],
            [1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0]
        ]
        
        # 构建完整的校验矩阵 [P^T | I4]
        H = []
        for i in range(4):
            row = P_T[i] + [0] * 4
            row[11 + i] = 1  # 单位矩阵部分
            H.append(row)
        
        return H
    
    def _build_syndrome_map(self) -> dict:
        """
        构建错误模式映射表
        
        Returns:
            综合征到错误位置的映射字典
        """
        syndrome_map = {}
        
        # 单比特错误模式
        for i in range(15):
            error = [0] * 15
            error[i] = 1
            syndrome = self._calculate_syndrome(error)
            syndrome_key = self._bits_to_int(syndrome)
            syndrome_map[syndrome_key] = i
        
        return syndrome_map
    
    def _bits_to_int(self, bits: List[int]) -> int:
        """将比特列表转换为整数"""
        return int(''.join(map(str, bits)), 2)
    
    def _int_to_bits(self, value: int, length: int) -> List[int]:
        """将整数转换为比特列表"""
        return [int(b) for b in bin(value)[2:].zfill(length)]
    
    def _matrix_multiply(self, vector: List[int], matrix: List[List[int]]) -> List[int]:
        """向量与矩阵相乘（模2）"""
        result = []
        for row in matrix:
            val = sum(a * b for a, b in zip(vector, row)) % 2
            result.append(val)
        return result
    
    def _calculate_syndrome(self, received: List[int]) -> List[int]:
        """计算综合征"""
        return self._matrix_multiply(received, self.H)
    
    def encode(self, data: int) -> int:
        """
        编码11位数据为15位汉明码
        
        Args:
            data: 11位整数数据
            
        Returns:
            15位汉明码
            
        Raises:
            ValueError: 如果数据超出11位范围
        """
        if data < 0 or data >= 2**11:
            raise ValueError("数据必须小于2^11")
        
        # 转换为11位比特向量
        data_bits = self._int_to_bits(data, 11)
        
        # 编码：codeword = data * G
        codeword = self._matrix_multiply(data_bits, self.G)
        
        # 转换为整数
        return self._bits_to_int(codeword)
    
    def decode(self, received: int) -> Tuple[int, bool, int]:
        """
        解码15位汉明码
        
        Args:
            received: 15位接收到的码字
            
        Returns:
            (decoded_data, has_error, corrected_bits)
            - decoded_data: 解码后的11位数据
            - has_error: 是否检测到错误
            - corrected_bits: 纠正的错误位数
            
        Raises:
            ValueError: 如果接收到的数据超出15位范围
        """
        if received < 0 or received >= 2**15:
            raise ValueError("接收数据必须小于2^15")
        
        # 转换为15位比特向量
        received_bits = self._int_to_bits(received, 15)
        
        # 计算综合征
        syndrome = self._calculate_syndrome(received_bits)
        syndrome_key = self._bits_to_int(syndrome)
        
        # 无错误
        if syndrome_key == 0:
            # 提取前11位作为数据
            data_bits = received_bits[:11]
            data = self._bits_to_int(data_bits)
            return data, False, 0
        
        # 单比特错误
        if syndrome_key in self.syndrome_map:
            error_pos = self.syndrome_map[syndrome_key]
            
            # 纠正错误
            corrected_bits = received_bits.copy()
            corrected_bits[error_pos] ^= 1
            
            # 提取数据
            data_bits = corrected_bits[:11]
            data = self._bits_to_int(data_bits)
            
            return data, True, 1
        
        # 多位错误（无法纠正）
        data_bits = received_bits[:11]
        data = self._bits_to_int(data_bits)
        return data, True, -1  # -1表示无法纠正的错误
    
    def batch_encode(self, data_list: List[int]) -> List[int]:
        """
        批量编码多个11位数据
        
        Args:
            data_list: 11位整数列表
            
        Returns:
            15位汉明码列表
        """
        return [self.encode(data) for data in data_list]
    
    def batch_decode(self, received_list: List[int]) -> List[Tuple[int, bool, int]]:
        """
        批量解码多个15位码字
        
        Args:
            received_list: 15位接收码字列表
            
        Returns:
            解码结果列表
        """
        return [self.decode(received) for received in received_list]