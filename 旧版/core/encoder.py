import numpy as np
from common.config import config

class DataEncoder:
    """数据编码类

    负责将原始数据编码为适合传输的格式
    """
    def __init__(self):
        """初始化编码器

        从配置中加载编码参数
        """
        self.block_size = config.get('data_transfer.block_size', 8)
        self.parity_bits = config.get('data_transfer.parity_bits', 4)

    def encode_data(self, data):
        """对数据进行编码，添加校验位

        Args:
            data (bytes): 原始二进制数据

        Returns:
            list: 编码后的数据列表，每个元素为15位整数

        Notes:
            实现了(15,11)汉明码，11位数据+4位校验
        """
        encoded = []
        for i in range(0, len(data), self.block_size):
            block = data[i:i+self.block_size]
            # 对每个数据块进行编码
            for byte in block:
                # 实现(15,11)汉明码
                # 11位数据位 + 4位校验位
                encoded_value = self._hamming_encode(byte)
                encoded.append(encoded_value)
        return encoded

    def _hamming_encode(self, byte):
        """汉明码编码

        Args:
            byte (int): 8位数据

        Returns:
            int: 15位编码值（11位数据+4位校验）

        Notes:
            简化实现，实际应用中应使用标准汉明码算法
        """
        # 扩展为11位数据
        data = byte << 3  # 8位扩展到11位

        # 计算校验位 (简化版本)
        parity = self._calculate_parity(data)

        # 组合数据和校验位
        encoded = (data << self.parity_bits) | parity
        return encoded

    def _calculate_parity(self, data):
        """计算校验位

        Args:
            data (int): 11位数据

        Returns:
            int: 4位校验值

        Notes:
            使用简单异或计算校验位，实际应用中应使用标准汉明码算法
        """
        # 简化的校验计算
        parity = 0
        for i in range(11):
            if data & (1 << i):
                parity ^= (i + 1)
        return parity & 0x0F  # 限制为4位

    def calculate_crc32(self, data):
        """计算数据的CRC32校验和

        Args:
            data (bytes): 输入数据

        Returns:
            int: CRC32校验和
        """
        crc = 0xFFFFFFFF
        for byte in data:
            crc ^= byte
            for _ in range(8):
                crc = (crc >> 1) ^ 0xEDB88320 if crc & 1 else crc >> 1
        return crc & 0xFFFFFFFF