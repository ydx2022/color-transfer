#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
彩色数据传输系统开发日志记录工具
用于记录每日开发进度、任务完成情况和学习心得
"""

import os
import sys
import argparse
import json
import shutil
import re
import time
from datetime import datetime, timedelta

# 项目配置
PROJECT_NAME = "彩色数据传输系统"
VERSION = "1.0.0"
DEVELOPER = "开发者"

# 路径配置
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE_DIR, "docs", "development_logs")
BACKUP_DIR = os.path.join(LOG_DIR, "backups")
MAIN_LOG_FILE = os.path.join(BASE_DIR, "docs", "DEVELOPMENT_LOG.md")
PROJECT_PLAN_FILE = os.path.join(BASE_DIR, "docs", "DEVELOPMENT_PLAN.md")

# 确保目录存在
os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)

class DevelopmentLogger:
    def __init__(self):
        self.start_time = None
        self.end_time = None
        self.task = ""
        self.done_items = []
        self.progress = 0
        self.module = ""
        self.next_plan = []
        self.code_snippet = ""
        self.issue = ""
        self.solution = ""
        self.test_result = ""
        self.screenshot = ""
        self.learning_note = ""
        self.today_tasks = []
        
        # 加载总开发时间
        self.total_development_time = self.get_total_development_time()
        
        # 加载模块进度
        self.module_progress = self.load_module_progress()

    def get_total_development_time(self):
        """获取总开发时间"""
        try:
            with open(os.path.join(BASE_DIR, "docs", "total_time.txt"), 'r') as f:
                return float(f.read().strip())
        except:
            return 0.0

    def save_total_development_time(self):
        """保存总开发时间"""
        with open(os.path.join(BASE_DIR, "docs", "total_time.txt"), 'w') as f:
            f.write(str(self.total_development_time))

    def load_module_progress(self):
        """加载模块进度"""
        try:
            with open(os.path.join(BASE_DIR, "docs", "module_progress.txt"), 'r') as f:
                return json.load(f)
        except:
            return {
                "发送端": 0,
                "接收端": 0,
                "编码器": 0,
                "解码器": 0,
                "颜色映射": 0,
                "模型训练": 0,
                "文件处理": 0
            }

    def save_module_progress(self):
        """保存模块进度"""
        with open(os.path.join(BASE_DIR, "docs", "module_progress.txt"), 'w') as f:
            json.dump(self.module_progress, f, ensure_ascii=False, indent=2)

    def load_project_plan(self):
        """加载项目计划"""
        try:
            with open(PROJECT_PLAN_FILE, 'r', encoding='utf-8') as f:
                content = f.read()
                # 简单的Markdown解析
                plan = {}
                current_phase = ""
                
                for line in content.split('\n'):
                    line = line.strip()
                    if line.startswith('## '):
                        current_phase = line[3:].strip()
                        plan[current_phase] = []
                    elif line.startswith('- ') and current_phase:
                        task = line[2:].strip()
                        if task and not task.startswith('#'):
                            plan[current_phase].append(task)
                
                return plan
        except:
            return {}

    def generate_today_tasks(self):
        """生成今日任务"""
        plan = self.load_project_plan()
        if not plan:
            return ["暂无计划任务，请检查项目计划文件"]

        # 根据总开发时间智能分配今日任务
        tasks = []
        
        # 计算开发阶段
        total_hours = self.total_development_time
        
        if total_hours < 5:  # 第1天
            tasks = [
                "安装Python 3.9开发环境",
                "安装VS Code编辑器",
                "创建项目文件夹结构",
                "学习Python变量和数据类型",
                "完成第一个Python程序"
            ]
        elif total_hours < 10:  # 第2天
            tasks = [
                "学习Python字符串操作",
                "学习Python输入输出",
                "完成矩形面积计算练习",
                "完成温度转换程序",
                "创建个性化问候语程序"
            ]
        elif total_hours < 15:  # 第3天
            tasks = [
                "安装opencv-python库",
                "安装numpy库",
                "安装pygame库",
                "学习图像基本操作",
                "创建简单图像处理程序"
            ]
        elif total_hours < 25:  # 第4-5天
            phase1_tasks = plan.get("阶段1：编程基础与环境准备", [])
            tasks = phase1_tasks[:5] if phase1_tasks else [
                "复习Python基础知识",
                "创建发送端基础框架",
                "实现数据编码函数",
                "测试编码功能"
            ]
        elif total_hours < 35:  # 第6-7天
            phase2_tasks = plan.get("阶段2：发送端基础开发与动态分页设计", [])
            tasks = phase2_tasks[:5] if phase2_tasks else [
                "实现颜色映射函数",
                "创建发送端测试界面",
                "设计动态分页结构",
                "实现文件读取功能"
            ]
        else:
            # 后续阶段
            for phase_name, phase_tasks in plan.items():
                if phase_tasks:
                    tasks.extend(phase_tasks[:3])
                    if len(tasks) >= 3:
                        break
            
            if not tasks:
                tasks = [
                    "继续当前模块的开发工作",
                    "优化代码性能",
                    "添加测试用例"
                ]

        self.today_tasks = tasks
        return tasks

    def start_log(self):
        """开始记录开发时间"""
        self.start_time = datetime.now()
        
        # 保存开始时间到文件
        session_file = os.path.join(BASE_DIR, "docs", "current_session.txt")
        with open(session_file, 'w') as f:
            f.write(self.start_time.isoformat())
        
        # 显示今日任务
        tasks = self.generate_today_tasks()
        print(f"\n🚀 开始开发工作！")
        print(f"开始时间: {self.start_time.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"\n📋 今日任务：")
        for i, task in enumerate(tasks, 1):
            print(f"  {i}. {task}")
        print(f"\n💡 提示：完成后使用")
        print(f"  python development_logger.py --complete \"任务描述\" 快速记录")

    def end_log(self):
        """结束记录开发时间"""
        try:
            # 读取开始时间
            session_file = os.path.join(BASE_DIR, "docs", "current_session.txt")
            if os.path.exists(session_file):
                with open(session_file, 'r') as f:
                    start_str = f.read().strip()
                    self.start_time = datetime.fromisoformat(start_str)
                os.remove(session_file)
            else:
                self.start_time = datetime.now()
            
            self.end_time = datetime.now()
            return True
        except Exception as e:
            print(f"读取会话文件失败: {e}")
            return False

    def classify_error(self, error_message):
        """错误分类"""
        error_lower = error_message.lower()
        if "syntax" in error_lower or "invalid syntax" in error_lower:
            return "语法错误"
        elif "import" in error_lower or "module" in error_lower:
            return "导入错误"
        elif "index" in error_lower or "out of range" in error_lower:
            return "索引错误"
        elif "type" in error_lower:
            return "类型错误"
        elif "file" in error_lower or "not found" in error_lower:
            return "文件错误"
        else:
            return "运行时错误"

    def generate_log(self):
        """生成Markdown格式的开发日志并追加到主日志文件"""
        if self.start_time is None or self.end_time is None:
            # 如果没有开始和结束时间，使用当前时间
            now = datetime.now()
            self.start_time = now.replace(hour=9, minute=0, second=0, microsecond=0)
            self.end_time = now
            
        duration = (self.end_time - self.start_time).total_seconds()
        hours = int(duration // 3600)
        minutes = int((duration % 3600) // 60)
        duration_str = f"{hours}小时{minutes}分钟"

        # 更新总开发时间
        self.total_development_time += hours + minutes / 60
        self.save_total_development_time()

        # 格式化日期
        date_str = self.start_time.strftime('%Y-%m-%d')
        weekday_str = self.start_time.strftime('%A')
        time_range_str = f"{self.start_time.strftime('%H:%M')}-{self.end_time.strftime('%H:%M')}"

        # 创建日志条目内容
        log_content = []
        log_content.append(f"# 开发日志 - {date_str}（{weekday_str}）\n")
        log_content.append(f"- **项目**：{PROJECT_NAME}\n")
        log_content.append(f"- **版本**：{VERSION}\n")
        log_content.append(f"- **开发者**：{DEVELOPER}\n")
        log_content.append(f"- **开发时间**：{time_range_str}（共{duration_str}）\n")
        log_content.append(f"- **累计开发时间**：{int(self.total_development_time)}小时{int((self.total_development_time % 1) * 60)}分钟\n\n")

        log_content.append("## 今日任务\n")
        if self.task:
            log_content.append(f"- {self.task}\n")
        else:
            # 如果没有指定任务，使用自动生成的任务
            log_content.append("- 自动生成的任务：\n")
            for i, task in enumerate(self.today_tasks, 1):
                log_content.append(f"  {i}. {task}\n")
        log_content.append("\n")

        log_content.append(f"## 完成进度（{self.progress}%）\n")
        if self.done_items:
            for item in self.done_items:
                log_content.append(f"- [x] {item}\n")
        if self.progress < 100:
            log_content.append(f"- [ ] 剩余任务（{100 - self.progress}%）\n")
        log_content.append("\n")

        if self.code_snippet:
            log_content.append("## 关键代码\n")
            log_content.append("```python\n")
            log_content.append(f"{self.code_snippet}\n")
            log_content.append("```\n\n")

        if self.issue:
            error_type = self.classify_error(self.issue)
            log_content.append("## 问题与解决方案\n")
            log_content.append("### 遇到的问题\n")
            log_content.append(f"问题描述：{self.issue}\n")
            log_content.append(f"错误类型：{error_type}\n\n")

            if self.solution:
                log_content.append("### 解决方案\n")
                log_content.append(f"{self.solution}\n\n")

        if self.test_result:
            log_content.append("## 测试结果\n")
            log_content.append(f"{self.test_result}\n\n")

        if self.screenshot:
            log_content.append("## 截图\n")
            log_content.append(f"![截图]({self.screenshot})\n\n")

        if self.next_plan:
            log_content.append("## 明日计划\n")
            for i, plan in enumerate(self.next_plan, 1):
                log_content.append(f"{i}. {plan}\n")
            log_content.append("\n")

        if self.learning_note:
            log_content.append("## 学习心得\n")
            log_content.append(f"{self.learning_note}\n\n")

        # 鼓励语句
        if self.progress >= 80:
            log_content.append("## 鼓励一下\n")
            log_content.append("太棒了！今天的进度超过了80%，继续保持！\n\n")

        log_content.append("---\n\n")  # 分隔符

        # 创建备份
        if os.path.exists(MAIN_LOG_FILE):
            backup_filename = f"development_log_backup_{int(time.time())}.md"
            shutil.copy2(MAIN_LOG_FILE, os.path.join(BACKUP_DIR, backup_filename))
            print(f"已创建日志备份: {backup_filename}")

        # 追加到主日志文件
        try:
            # 检查文件是否存在，如果不存在则创建并写入标题
            if not os.path.exists(MAIN_LOG_FILE):
                with open(MAIN_LOG_FILE, 'w', encoding='utf-8') as f:
                    f.write(f"# {PROJECT_NAME} 开发日志\n\n")
                    f.write("## 项目开发历程\n\n")

            # 追加日志内容
            with open(MAIN_LOG_FILE, 'a', encoding='utf-8') as f:
                f.writelines(log_content)

            print(f"开发日志已追加到: {MAIN_LOG_FILE}")
            return MAIN_LOG_FILE
        except Exception as e:
            print(f"写入日志文件失败: {e}")
            return None

    def quick_complete_task(self, done_description):
        """快速完成任务"""
        print(f"🔄 快速完成任务: {done_description}")
        
        # 获取当前任务
        tasks = self.generate_today_tasks()
        if not tasks:
            print("❌ 没有待完成任务")
            return
            
        current_task = tasks[0]
        
        # 设置当前时间作为开始和结束时间
        now = datetime.now()
        self.start_time = now.replace(hour=9, minute=0, second=0, microsecond=0)
        self.end_time = now
        
        # 设置任务信息
        self.task = current_task
        self.done_items = [done_description]
        self.progress = 100
        self.module = "通用"
        self.next_plan = []
        
        # 生成日志
        self.generate_log()
        
        # 显示剩余任务
        print("\n📋 任务已完成！剩余任务：")
        remaining_tasks = self.generate_today_tasks()
        if remaining_tasks:
            for i, task in enumerate(remaining_tasks, 1):
                print(f"  {i}. {task}")
            print(f"\n🚀 开始下一个任务：")
            print(f"python development_logger.py --start")
        else:
            print("🎉 所有任务已完成！")

    def interactive_task_manager(self):
        """交互式任务管理"""
        tasks = self.generate_today_tasks()
        if not tasks:
            print("❌ 没有待完成任务")
            return
            
        print("\n=== 交互式任务管理 ===")
        for i, task in enumerate(tasks, 1):
            print(f"  {i}. {task}")
            
        try:
            choice = int(input("\n选择要完成的任务编号 (输入数字): ")) - 1
            if 0 <= choice < len(tasks):
                task = tasks[choice]
                done = input(f"任务完成情况描述: ")
                if done.strip():
                    # 设置当前时间作为开始和结束时间
                    now = datetime.now()
                    self.start_time = now.replace(hour=9, minute=0, second=0, microsecond=0)
                    self.end_time = now
                    
                    self.task = task
                    self.done_items = [done]
                    self.progress = 100
                    self.module = "通用"
                    self.next_plan = []
                    self.generate_log()
                    print("✅ 任务已完成！")
                    
                    # 显示剩余任务
                    remaining = self.generate_today_tasks()
                    if remaining:
                        print("\n📋 剩余任务：")
                        for i, t in enumerate(remaining, 1):
                            print(f"  {i}. {t}")
                        print(f"\n🚀 使用: python development_logger.py --start 开始下一个")
                    else:
                        print("🎉 所有任务已完成！")
            else:
                print("❌ 无效的任务编号")
        except ValueError:
            print("❌ 请输入有效的数字")

    def parse_arguments(self, args):
        """解析命令行参数"""
        parser = argparse.ArgumentParser(description='彩色数据传输系统开发日志记录工具')
        parser.add_argument('--start', action='store_true', help='开始记录开发时间')
        parser.add_argument('--end', action='store_true', help='结束记录开发时间并生成日志')
        parser.add_argument('--task', type=str, help='当日任务描述')
        parser.add_argument('--done', type=str, help='已完成事项')
        parser.add_argument('--progress', type=int, help='完成进度百分比')
        parser.add_argument('--module', type=str, help='所属模块')
        parser.add_argument('--next', type=str, help='下一步任务（逗号分隔）')
        parser.add_argument('--complete', type=str, help='快速完成任务（提供完成描述）')
        parser.add_argument('--list', action='store_true', help='显示今日任务列表')
        parser.add_argument('--interactive', action='store_true', help='交互式任务管理')
        return parser.parse_args(args)

    def main(self):
        """主函数"""
        args = self.parse_arguments(sys.argv[1:])
        
        # 无参数时显示今日任务
        if len(sys.argv) == 1 or args.list:
            tasks = self.generate_today_tasks()
            if not tasks:
                print("\n📝 今日暂无任务")
                print("\n📱 快捷命令:")
                print("  python development_logger.py --start              # 开始记录")
                print("  python development_logger.py --complete \"描述\"   # 快速完成")
                return
                
            print("\n🎯 === 彩色数据传输系统 - 今日任务 ===")
            total_time = self.get_total_development_time()
            print(f"📊 累计开发时间: {total_time:.1f}小时")
            print()
            for i, task in enumerate(tasks, 1):
                print(f"  {i}. {task}")
            
            print("\n📱 快捷命令:")
            print("  python development_logger.py --start              # 开始记录")
            print("  python development_logger.py --complete \"描述\"   # 快速完成")
            print("  python development_logger.py --interactive         # 交互式管理")
            print("  python development_logger.py --end --task \"任务\" --done \"完成\" --progress 50")
            return
            
        if args.start:
            self.start_log()
        elif args.end:
            if self.end_log():
                self.task = args.task or ""
                self.done_items = [args.done] if args.done else []
                self.progress = args.progress or 0
                self.module = args.module or "通用"
                if args.next:
                    self.next_plan = [item.strip() for item in args.next.split(',')]
                
                # 更新模块进度
                if args.module and args.module in self.module_progress:
                    self.module_progress[args.module] = max(self.module_progress[args.module], self.progress)
                    self.save_module_progress()
                
                self.generate_log()
        elif args.complete:
            self.quick_complete_task(args.complete)
        elif args.interactive:
            self.interactive_task_manager()
        else:
            # 其他情况显示帮助
            tasks = self.generate_today_tasks()
            print("\n🎯 === 彩色数据传输系统 - 今日任务 ===")
            total_time = self.get_total_development_time()
            print(f"📊 累计开发时间: {total_time:.1f}小时")
            print()
            for i, task in enumerate(tasks, 1):
                print(f"  {i}. {task}")
            print("\n使用方法:")
            print("  python development_logger.py --start    # 开始记录")
            print("  python development_logger.py --complete \"描述\"   # 快速完成")
            print("  python development_logger.py --interactive")

def main():
    logger = DevelopmentLogger()
    logger.main()

if __name__ == "__main__":
    main()