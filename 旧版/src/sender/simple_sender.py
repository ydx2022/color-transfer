"""
简化的发送端
将数据转换为颜色并在控制台显示
"""

import time
from ..core.encoder import SimpleEncoder
from ..core.color_mapper import SimpleColorMapper

class SimpleSender:
    """简化的发送端"""
    
    def __init__(self):
        self.encoder = SimpleEncoder()
        self.mapper = SimpleColorMapper()
        
    def send_text(self, text, delay=1.0):
        """发送文本数据"""
        print(f"准备发送文本: '{text}'")
        
        # 编码文本
        blocks = self.encoder.encode_text(text)
        print(f"生成 {len(blocks)} 个数据块")
        
        # 转换为颜色
        colors = []
        for i, block in enumerate(blocks):
            color = self.mapper.map_to_color(block)
            colors.append(color)
            print(f"块 {i+1}: 数据 {block} -> 颜色 RGB{color}")
        
        # 模拟显示颜色
        print("\n=== 开始传输 ===")
        for i, color in enumerate(colors):
            print(f"显示颜色 {i+1}/{len(colors)}: RGB{color}")
            time.sleep(delay)
        
        print("传输完成!")
        return colors
    
    def test(self):
        """测试函数"""
        test_text = "Hi!"
        print("=== 发送端测试 ===")
        self.send_text(test_text, delay=0.5)


if __name__ == "__main__":
    sender = SimpleSender()
    sender.test()