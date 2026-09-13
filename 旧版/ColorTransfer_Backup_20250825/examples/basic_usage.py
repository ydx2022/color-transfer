#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
发送端使用示例 - 彩色数据传输系统
"""

import os
import sys

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from sender.color_sender import ColorSender

def main():
    """发送端使用示例"""
    
    # 确保在正确的目录下运行
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(current_dir)
    
    # 添加项目根目录到Python路径
    if project_root not in sys.path:
        sys.path.insert(0, project_root)
    
    print("🚀 彩色数据传输系统 - 发送端示例")
    print("=" * 50)
    
    try:
        # 创建发送端实例
        sender = ColorSender()
        
        # 获取配置信息
        info = sender.get_frame_info()
        print("\n📊 当前配置:")
        for key, value in info.items():
            print(f"   {key}: {value}")
        
        # 创建输出目录
        output_dir = os.path.join(current_dir, "output")
        
        # 示例1: 发送文本数据
        print("\n📝 示例1: 发送文本数据")
        text_data = "Hello, Color Transfer System! This is a test message."
        text_bytes = text_data.encode('utf-8')
        
        # 创建单个数据帧
        frame = sender.create_data_frame(text_bytes)
        
        # 保存示例图像
        example_path = os.path.join(output_dir, "example_text.png")
        import cv2
        cv2.imwrite(example_path, frame)
        print(f"✅ 文本数据帧已保存: {example_path}")
        
        # 示例2: 发送小文件
        print("\n📁 示例2: 创建测试文件")
        test_file = os.path.join(output_dir, "test_data.txt")
        with open(test_file, 'w', encoding='utf-8') as f:
            f.write("这是一个测试文件\n")
            f.write("包含多行文本\n")
            f.write("用于测试彩色数据传输系统\n")
        
        # 发送测试文件
        print("🔄 正在处理测试文件...")
        frames = sender.send_file(test_file, output_dir)
        print(f"✅ 生成了 {len(frames)} 个数据帧")
        
        # 显示前几个帧的信息
        for i, frame_path in enumerate(frames[:3]):
            print(f"   帧 {i+1}: {os.path.basename(frame_path)}")
        
        if len(frames) > 3:
            print(f"   ... 还有 {len(frames) - 3} 个帧")
        
        # 示例3: 预览功能
        print("\n👀 示例3: 预览功能")
        print("正在显示预览窗口...")
        sender.preview_frame(b"Preview test data 12345")
        
        print("\n🎉 发送端示例完成！")
        print("\n📱 快速开始:")
        print("   python -m sender.example_usage")
        
    except Exception as e:
        print(f"❌ 错误: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()