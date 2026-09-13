import json
import numpy as np
from sender import ColorSender

# 加载配置文件
with open('config.json', 'r') as f:
    config = json.load(f)

# 初始化发送器
sender = ColorSender()

# 测试颜色映射函数
print("=== 颜色映射功能测试 ===")
# 测试低段值 (0-15)
print("\n低段值测试 (0-15):")
for value in range(0, 16):
    # 创建15位数据，将测试值放入RGB通道
    data = (value << 10) | (value << 5) | value
    colors = sender.data_to_color([data])
    r, g, b = colors[0]
    print(f"值: {value}, 数据: {data:015b}, RGB: ({r}, {g}, {b})")

# 测试高段值 (16-31)
print("\n高段值测试 (16-31):")
for value in range(16, 32):
    # 创建15位数据，将测试值放入RGB通道
    data = (value << 10) | (value << 5) | value
    colors = sender.data_to_color([data])
    r, g, b = colors[0]
    print(f"值: {value}, 数据: {data:015b}, RGB: ({r}, {g}, {b})")

# 测试边界情况
print("\n边界情况测试:")
min_data = 0
max_data = (1 << 15) - 1
min_colors = sender.data_to_color([min_data])
max_colors = sender.data_to_color([max_data])
min_r, min_g, min_b = min_colors[0]
max_r, max_g, max_b = max_colors[0]
print(f"最小数据: {min_data:015b}, RGB: ({min_r}, {min_g}, {min_b})")
print(f"最大数据: {max_data:015b}, RGB: ({max_r}, {max_g}, {max_b})")

# 生成测试图像
print("\n生成测试图像...")
# 创建一个包含所有32个可能值的测试数据
test_data = [(i << 10) | (i << 5) | i for i in range(32)]
# 将数据映射为颜色
colors = sender.data_to_color(test_data)
# 生成图像
frame = sender.create_frame(colors)
# 保存图像
import cv2
cv2.imwrite('test_color_mapping.png', frame)
print("测试图像已保存为 test_color_mapping.png")