#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
任务管理助手 - 自动切换任务
这个脚本帮你自动结束当前任务并开始新任务
"""

import os
import sys
import subprocess
from datetime import datetime

def get_today_tasks():
    """获取今日任务列表"""
    try:
        from development_logger import DevelopmentLogger
        logger = DevelopmentLogger()
        return logger.generate_today_tasks()
    except:
        return [
            "安装Python 3.9开发环境",
            "安装VS Code编辑器",
            "创建项目文件夹结构",
            "学习Python变量和数据类型",
            "完成基础编程练习"
        ]

def show_current_tasks():
    """显示当前任务列表"""
    tasks = get_today_tasks()
    print("\n=== 今日任务列表 ===")
    for i, task in enumerate(tasks, 1):
        print(f"{i}. {task}")
    return tasks

def complete_and_next(task_number=None, completed_desc=""):
    """完成任务并自动开始下一个"""
    tasks = show_current_tasks()
    
    if task_number is None:
        print("\n请选择要完成的任务编号 (1-5):")
        try:
            task_number = int(input().strip())
        except:
            task_number = 1
    
    if 1 <= task_number <= len(tasks):
        completed_task = tasks[task_number-1]
        
        # 结束当前任务
        if not completed_desc:
            completed_desc = f"完成了任务：{completed_task}"
        
        print(f"\n✅ 完成任务：{completed_task}")
        
        # 自动执行结束记录
        cmd = [
            sys.executable, 
            "development_logger.py", 
            "--end", 
            "--task", completed_task,
            "--done", completed_desc,
            "--progress", str(task_number * 20)
        ]
        
        try:
            subprocess.run(cmd, check=True)
            print("\n🎉 任务记录完成！")
            
            # 显示剩余任务
            print("\n=== 剩余任务 ===")
            remaining = tasks[task_number:] if task_number < len(tasks) else ["所有任务已完成！"]
            for i, task in enumerate(remaining, 1):
                print(f"{i}. {task}")
                
            if task_number < len(tasks):
                print(f"\n📋 下一个任务：{tasks[task_number]}")
                print("使用：python development_logger.py --start  开始新任务")
            
        except subprocess.CalledProcessError as e:
            print(f"❌ 记录失败：{e}")
    else:
        print("❌ 无效的任务编号")

def quick_complete(task_desc=""):
    """快速完成当前任务"""
    if not task_desc:
        task_desc = datetime.now().strftime("%H:%M 完成的任务")
    
    cmd = [
        sys.executable,
        "development_logger.py",
        "--end",
        "--task", "当前任务",
        "--done", task_desc,
        "--progress", "100"
    ]
    
    try:
        subprocess.run(cmd, check=True)
        print("✅ 任务快速完成！")
    except:
        print("❌ 快速完成失败")

def main():
    if len(sys.argv) > 1:
        if sys.argv[1] == "next":
            complete_and_next()
        elif sys.argv[1] == "quick":
            quick_complete(" ".join(sys.argv[2:]) if len(sys.argv) > 2 else "")
        else:
            show_current_tasks()
    else:
        show_current_tasks()
        print("\n使用方法：")
        print("  python task_manager.py        # 查看任务")
        print("  python task_manager.py next   # 交互式完成任务")
        print("  python task_manager.py quick  # 快速完成当前任务")
        print("  python task_manager.py quick 完成Python安装  # 快速完成并记录")

if __name__ == "__main__":
    main()