#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
发送端测试脚本 - 彩色数据传输系统
"""

import os
import sys
import cv2
import numpy as np

# 添加项目根目录到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_dir)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from sender.color_sender import ColorSender

def test_initialization():
    """测试初始化功能"""
    print("🔍 测试1: 初始化测试")
    try:
        sender = ColorSender()
        info = sender.get_frame_info()
        
        print(f"   ✅ 初始化成功")
        print(f"   📱 分辨率: {info['screen_resolution']}")
        print(f"   🔲 色块大小: {info['block_size']}px")
        print(f"   📊 网格: {info['grid_size']}")
        print(f"   📦 每帧数据: {info['bytes_per_frame']}字节")
        
        return True
    except Exception as e:
        print(f"   ❌ 初始化失败: {e}")
        return False

def test_data_encoding():
    """测试数据编码功能"""
    print("\n🔍 测试2: 数据编码测试")
    try:
        sender = ColorSender()
        
        # 测试不同长度的数据
        test_cases = [
            b"Hello",
            b"Hello World!",
            b"A" * 100,
            "中文测试数据".encode('utf-8')
        ]
        
        for i, data in enumerate(test_cases):
            encoded = sender.encode_data(data)
            colors = sender.data_to_colors(encoded)
            
            print(f"   ✅ 测试{i+1}: {len(data)}字节 → {len(encoded)}个编码值 → {len(colors)}个颜色")
            
            # 验证颜色范围
            for r, g, b in colors[:3]:  # 检查前3个颜色
                if not (65 <= r <= 255 and 65 <= g <= 255 and 65 <= b <= 255):
                    print(f"   ❌ 颜色值超出范围: ({r}, {g}, {b})")
                    return False
        
        return True
    except Exception as e:
        print(f"   ❌ 编码测试失败: {e}")
        return False

def test_frame_creation():
    """测试帧生成功能"""
    print("\n🔍 测试3: 帧生成测试")
    try:
        sender = ColorSender()
        
        # 创建测试数据
        test_data = b"Test frame creation 12345"
        frame = sender.create_data_frame(test_data)
        
        # 验证帧尺寸
        expected_shape = (900, 1600, 3)  # 基于配置
        if frame.shape != expected_shape:
            print(f"   ❌ 帧尺寸错误: {frame.shape}, 期望: {expected_shape}")
            return False
        
        # 验证数据类型
        if frame.dtype != np.uint8:
            print(f"   ❌ 数据类型错误: {frame.dtype}")
            return False
        
        # 检查同步图案区域 (应该是非零值)
        sync_area = frame[0:60, 0:60]
        if np.all(sync_area == 0):
            print(f"   ❌ 同步图案区域全黑")
            return False
        
        print(f"   ✅ 帧生成成功: {frame.shape}, 数据类型: {frame.dtype}")
        
        # 保存测试帧
        test_dir = os.path.join(current_dir, "test_output")
        os.makedirs(test_dir, exist_ok=True)
        test_path = os.path.join(test_dir, "test_frame.png")
        cv2.imwrite(test_path, frame)
        print(f"   💾 测试帧已保存: {test_path}")
        
        return True
    except Exception as e:
        print(f"   ❌ 帧生成测试失败: {e}")
        return False

def test_file_sending():
    """测试文件发送功能"""
    print("\n🔍 测试4: 文件发送测试")
    try:
        sender = ColorSender()
        
        # 创建测试文件
        test_dir = os.path.join(current_dir, "test_output")
        os.makedirs(test_dir, exist_ok=True)
        
        test_file = os.path.join(test_dir, "test_input.txt")
        test_content = "This is a test file for color transfer system.\n" * 10
        
        with open(test_file, 'w', encoding='utf-8') as f:
            f.write(test_content)
        
        # 发送文件
        frames = sender.send_file(test_file, test_dir)
        
        if not frames:
            print(f"   ❌ 未生成任何帧")
            return False
        
        # 验证生成的文件
        for frame_path in frames:
            if not os.path.exists(frame_path):
                print(f"   ❌ 文件不存在: {frame_path}")
                return False
            
            # 检查文件大小
            size = os.path.getsize(frame_path)
            if size == 0:
                print(f"   ❌ 空文件: {frame_path}")
                return False
        
        print(f"   ✅ 文件发送成功: 生成了 {len(frames)} 个帧")
        print(f"   📁 测试文件: {test_file} ({len(test_content)}字节)")
        
        # 清理测试文件
        os.remove(test_file)
        
        return True
    except Exception as e:
        print(f"   ❌ 文件发送测试失败: {e}")
        return False

def test_edge_cases():
    """测试边界情况"""
    print("\n🔍 测试5: 边界情况测试")
    try:
        sender = ColorSender()
        
        # 测试空数据
        empty_data = b""
        frame = sender.create_data_frame(empty_data)
        print(f"   ✅ 空数据处理成功")
        
        # 测试大数据
        large_data = b"X" * 1000
        encoded = sender.encode_data(large_data)
        colors = sender.data_to_colors(encoded)
        print(f"   ✅ 大数据处理成功: {len(large_data)}字节 → {len(colors)}个颜色")
        
        # 测试特殊字符
        special_data = "特殊字符测试: \u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e6\u00e7\u00e8\u00e9\u00ea\u00eb".encode('utf-8')
        encoded = sender.encode_data(special_data)
        print(f"   ✅ 特殊字符处理成功")
        
        return True
    except Exception as e:
        print(f"   ❌ 边界测试失败: {e}")
        return False

def test_color_mapping():
    """测试颜色映射准确性"""
    print("\n🔍 测试6: 颜色映射准确性测试")
    try:
        sender = ColorSender()
        
        # 测试已知值
        test_value = 0b111110000011111  # 最大15位值
        colors = sender.data_to_colors([test_value])
        r, g, b = colors[0]
        
        # 验证映射是否正确
        expected_r = 65 + 31 * 6  # 高5位全1
        expected_g = 65 + 0 * 6   # 中5位全0
        expected_b = 65 + 31 * 6  # 低5位全1
        
        if abs(r - expected_r) <= 1 and abs(g - expected_g) <= 1 and abs(b - expected_b) <= 1:
            print(f"   ✅ 颜色映射准确: ({r}, {g}, {b})")
        else:
            print(f"   ❌ 颜色映射错误: 期望({expected_r}, {expected_g}, {expected_b}), 实际({r}, {g}, {b})")
            return False
        
        return True
    except Exception as e:
        print(f"   ❌ 颜色映射测试失败: {e}")
        return False

def run_all_tests():
    """运行所有测试"""
    print("🧪 开始发送端测试套件")
    print("=" * 50)
    
    tests = [
        test_initialization,
        test_data_encoding,
        test_frame_creation,
        test_file_sending,
        test_edge_cases,
        test_color_mapping
    ]
    
    passed = 0
    total = len(tests)
    
    for test in tests:
        if test():
            passed += 1
        print()
    
    print("=" * 50)
    print(f"📊 测试结果: {passed}/{total} 通过")
    
    if passed == total:
        print("🎉 所有测试通过！发送端功能正常")
    else:
        print("⚠️  部分测试失败，请检查错误信息")
    
    return passed == total

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)