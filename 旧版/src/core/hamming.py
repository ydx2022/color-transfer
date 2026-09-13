"""
简化的汉明码(11,15)编解码器
专为初中生设计的简化版本
"""

class SimpleHammingCodec:
    """简化的汉明码编解码器"""
    
    def __init__(self):
        # 简化的生成矩阵（只保留核心功能）
        self.parity_positions = [3, 5, 6, 7]  # 校验位位置
        
    def encode(self, data):
        """编码11位数据为15位汉明码"""
        if data < 0 or data >= 2048:  # 2^11 = 2048
            raise ValueError("数据必须是11位整数 (0-2047)")
        
        # 将数据转换为二进制列表
        bits = [int(bit) for bit in bin(data)[2:].zfill(11)]
        
        # 创建15位编码（先放数据位，后放校验位）
        encoded = [0] * 15
        data_index = 0
        
        # 放置数据位（跳过校验位位置）
        for i in range(15):
            if i not in self.parity_positions:
                encoded[i] = bits[data_index]
                data_index += 1
        
        # 计算校验位（简化版本）
        encoded[3] = encoded[1] ^ encoded[2] ^ encoded[4] ^ encoded[8] ^ encoded[9]
        encoded[5] = encoded[0] ^ encoded[2] ^ encoded[4] ^ encoded[8] ^ encoded[10]
        encoded[6] = encoded[0] ^ encoded[1] ^ encoded[4] ^ encoded[9] ^ encoded[10]
        encoded[7] = encoded[0] ^ encoded[1] ^ encoded[2] ^ encoded[8] ^ encoded[10]
        
        # 转换为整数
        result = 0
        for bit in encoded:
            result = (result << 1) | bit
            
        return result
    
    def decode(self, coded_data):
        """解码15位汉明码"""
        if coded_data < 0 or coded_data >= 32768:  # 2^15 = 32768
            raise ValueError("编码数据必须是15位整数")
        
        # 转换为二进制列表
        bits = [int(bit) for bit in bin(coded_data)[2:].zfill(15)]
        
        # 计算校验位（简化错误检测）
        p1 = bits[1] ^ bits[2] ^ bits[4] ^ bits[8] ^ bits[9] ^ bits[3]
        p2 = bits[0] ^ bits[2] ^ bits[4] ^ bits[8] ^ bits[10] ^ bits[5]
        p3 = bits[0] ^ bits[1] ^ bits[4] ^ bits[9] ^ bits[10] ^ bits[6]
        p4 = bits[0] ^ bits[1] ^ bits[2] ^ bits[8] ^ bits[10] ^ bits[7]
        
        # 如果有错误，尝试纠正（简化版本）
        error_pos = p1 + p2*2 + p3*4 + p4*8 - 1
        if error_pos >= 0 and error_pos < 15:
            bits[error_pos] = 1 - bits[error_pos]
            corrected = True
        else:
            corrected = False
        
        # 提取数据位
        decoded = 0
        data_index = 0
        
        for i in range(15):
            if i not in self.parity_positions:
                decoded = (decoded << 1) | bits[i]
                data_index += 1
        
        return decoded, corrected
    
    def test(self):
        """测试函数"""
        test_data = 0b10101010101  # 1365
        
        print("=== 汉明码测试 ===")
        print(f"原始数据: {bin(test_data)} ({test_data})")
        
        encoded = self.encode(test_data)
        print(f"编码后: {bin(encoded)} ({encoded})")
        
        decoded, corrected = self.decode(encoded)
        print(f"解码后: {bin(decoded)} ({decoded})")
        print(f"纠错: {corrected}")
        print(f"测试结果: {'通过' if decoded == test_data else '失败'}")


if __name__ == "__main__":
    codec = SimpleHammingCodec()
    codec.test()