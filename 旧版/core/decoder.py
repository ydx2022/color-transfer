import numpy as np
from common.config import config

class DataDecoder:
    """数据解码类

    负责将接收到的编码数据解码为原始数据
    """
    def __init__(self):
        """初始化解码器

        从配置中加载解码参数
        """
        self.block_size = config.get('data_transfer.block_size', 8)
        self.parity_bits = config.get('data_transfer.parity_bits', 4)

    def decode_data(self, encoded_data):
        """解码数据

        Args:
            encoded_data (list): 15位编码数据列表

        Returns:
            bytes: 解码后的原始数据

        Notes:
            包含汉明码纠错功能
        """
        decoded = []
        for value in encoded_data:
            # 汉明码纠错
            corrected = self._hamming_decode(value)
            # 提取数据位
            byte = (corrected >> 3) & 0xFF  # 取高8位
            decoded.append(byte)
        return bytes(decoded)

    def _hamming_decode(self, encoded):
        """汉明码解码

        Args:
            encoded (int): 15位编码值

        Returns:
            int: 纠错后的数据值

        Notes:
            实现单比特错误纠正
        """
        # 分离数据和校验位
        data = encoded >> self.parity_bits
        parity = encoded & ((1 << self.parity_bits) - 1)

        # 计算校验和以检测错误
        calculated_parity = self._calculate_parity(data)

        # 检测错误
        if calculated_parity != parity:
            # 简单的错误定位 (实际应用中应使用标准汉明码纠错算法)
            error_pos = calculated_parity ^ parity
            if error_pos <= 11:
                # 纠正错误位
                data ^= (1 << (error_pos - 1))

        return data

    def _calculate_parity(self, data):
        """计算校验位

        Args:
            data (int): 11位数据

        Returns:
            int: 4位校验值

        Notes:
            与编码器中的方法相同
        """
        parity = 0
        for i in range(11):
            if data & (1 << i):
                parity ^= (i + 1)
        return parity & 0x0F  # 限制为4位