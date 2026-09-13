"""
简化的数据编码器
将文本数据编码为15位数据块
"""

class SimpleEncoder:
    """简化的数据编码器"""
    
    def __init__(self):
        self.hamming = None
        
    def text_to_binary(self, text):
        """将文本转换为二进制字符串"""
        binary = ''
        for char in text:
            # 每个字符转换为8位二进制
            binary += bin(ord(char))[2:].zfill(8)
        return binary
    
    def binary_to_text(self, binary):
        """将二进制字符串转换回文本"""
        text = ''
        # 每8位为一个字符
        for i in range(0, len(binary), 8):
            byte = binary[i:i+8]
            if len(byte) == 8:
                char_code = int(byte, 2)
                text += chr(char_code)
        return text
    
    def encode_text(self, text, use_hamming=False):
        """编码文本数据"""
        # 转换为二进制
        binary = self.text_to_binary(text)
        
        # 分割为11位数据块
        blocks = []
        for i in range(0, len(binary), 11):
            block = binary[i:i+11]
            if len(block) < 11:
                # 填充剩余位
                block = block.ljust(11, '0')
            blocks.append(int(block, 2))
        
        # 如果需要汉明码编码
        encoded_blocks = []
        if use_hamming and self.hamming:
            for block in blocks:
                encoded_blocks.append(self.hamming.encode(block))
        else:
            encoded_blocks = blocks
        
        return encoded_blocks
    
    def decode_text(self, blocks, use_hamming=False):
        """解码数据块为文本"""
        # 如果需要汉明码解码
        decoded_blocks = []
        if use_hamming and self.hamming:
            for block in blocks:
                decoded, _ = self.hamming.decode(block)
                decoded_blocks.append(decoded)
        else:
            decoded_blocks = blocks
        
        # 转换为二进制字符串
        binary = ''
        for block in decoded_blocks:
            binary += bin(block)[2:].zfill(11)
        
        # 转换为文本
        return self.binary_to_text(binary)
    
    def set_hamming_codec(self, hamming_codec):
        """设置汉明码编解码器"""
        self.hamming = hamming_codec
    
    def test(self):
        """测试函数"""
        test_text = "Hello!"
        
        print("=== 编码器测试 ===")
        print(f"原始文本: '{test_text}'")
        
        # 测试无汉明码编码
        blocks = self.encode_text(test_text, use_hamming=False)
        print(f"编码块: {blocks}")
        
        decoded = self.decode_text(blocks, use_hamming=False)
        print(f"解码文本: '{decoded}'")
        print(f"测试结果: {'通过' if decoded == test_text else '失败'}")


if __name__ == "__main__":
    encoder = SimpleEncoder()
    encoder.test()