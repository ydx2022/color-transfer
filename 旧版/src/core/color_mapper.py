"""
简化的颜色映射器
将15位数据映射为RGB颜色值
"""

class SimpleColorMapper:
    """简化的颜色映射器"""
    
    def __init__(self, min_brightness=65, max_brightness=255):
        self.min_brightness = min_brightness
        self.max_brightness = max_brightness
        
        # 计算颜色步长（32级灰度）
        self.step = (max_brightness - min_brightness) // 31
    
    def map_to_color(self, data):
        """将15位数据映射为RGB颜色"""
        if data < 0 or data >= 32768:  # 2^15 = 32768
            raise ValueError("数据必须是15位整数")
        
        # 将15位数据分为3个5位组
        r_bits = (data >> 10) & 0x1F  # 高5位 -> 红色
        g_bits = (data >> 5) & 0x1F   # 中5位 -> 绿色
        b_bits = data & 0x1F          # 低5位 -> 蓝色
        
        # 映射到颜色值
        r = self.min_brightness + r_bits * self.step
        g = self.min_brightness + g_bits * self.step
        b = self.min_brightness + b_bits * self.step
        
        # 确保不超过最大值
        r = min(r, self.max_brightness)
        g = min(g, self.max_brightness)
        b = min(b, self.max_brightness)
        
        return (r, g, b)
    
    def color_to_data(self, r, g, b):
        """将RGB颜色转回15位数据"""
        # 反向映射
        r_value = (r - self.min_brightness) // self.step
        g_value = (g - self.min_brightness) // self.step
        b_value = (b - self.min_brightness) // self.step
        
        # 组合为15位数据
        data = (r_value << 10) | (g_value << 5) | b_value
        
        return data
    
    def test(self):
        """测试函数"""
        test_data = 0b101010101010101  # 21845
        
        print("=== 颜色映射测试 ===")
        print(f"原始数据: {bin(test_data)} ({test_data})")
        
        color = self.map_to_color(test_data)
        print(f"映射颜色: RGB{color}")
        
        recovered = self.color_to_data(*color)
        print(f"恢复数据: {bin(recovered)} ({recovered})")
        print(f"测试结果: {'通过' if recovered == test_data else '失败'}")


if __name__ == "__main__":
    mapper = SimpleColorMapper()
    mapper.test()