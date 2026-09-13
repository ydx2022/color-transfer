#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键任务切换器
一键完成当前任务并开始下一个
"""

import os
import sys
import subprocess

def main():
    """一键完成任务并准备下一个"""
    
    # 快速完成当前任务
    print("🔄 正在完成当前任务...")
    cmd = [
        sys.executable,
        "development_logger.py",
        "--end",
        "--task", "当前任务完成",
        "--done", "任务已标记完成",
        "--progress", "100"
    ]
    
    try:
        subprocess.run(cmd, check=True)
        print("✅ 当前任务已完成")
        
        # 显示下一步
        print("\n📋 准备开始新任务...")
        subprocess.run([sys.executable, "development_logger.py"], check=True)
        
        print("\n🚀 使用以下命令开始新任务：")
        print("python development_logger.py --start")
        
    except subprocess.CalledProcessError as e:
        print(f"❌ 操作失败：{e}")
        print("请手动使用：")
        print("python development_logger.py --end --task \"任务\" --done \"完成\" --progress 100")

if __name__ == "__main__":
    main()