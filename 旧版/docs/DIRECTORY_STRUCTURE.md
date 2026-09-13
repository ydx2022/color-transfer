# 📁 彩色数据传输系统 - 整合后目录结构

## 🎯 项目根目录

```
ColorTransfer/
├── 📄 README.md                    # 项目主文档
├── 📄 requirements.txt            # 依赖包列表
├── 📄 next_task.py                  # 任务管理入口
├── 📄 development_logger.py        # 开发日志工具
└── 📄 task_manager.py             # 任务调度器
```

## 🏗️ 核心架构目录

### 📊 配置层
```
config/
└── 📄 config.json                 # 系统配置文件
```

### ⚙️ 核心工具层
```
core/
├── 📄 __init__.py                # 核心模块导出
├── 📄 hamming.py                 # (11,15)汉明码编解码
├── 📄 encoder.py                 # 数据编码器（基础）
└── 📄 decoder.py                 # 数据解码器（基础）
```

### 📡 发送端模块
```
sender/
├── 📄 __init__.py                # 发送端模块导出
├── 📄 color_sender.py            # 主入口类
├── 📄 data_encoder.py            # 数据编码（11位→汉明码→15位）
├── 📄 color_mapper.py            # 颜色映射（15位→RGB）
├── 📄 frame_generator.py         # 图像帧生成
├── 📄 display_manager.py         # 显示管理
├── 📄 example_usage.py           # 使用示例
├── 📄 test_sender.py             # 测试套件
└── 📁 tests/                     # 单元测试
    └── 📄 test_sender.py
```

### 📥 接收端模块
```
receiver/
├── 📄 __init__.py                # 接收端模块导出
└── 📁 tests/                     # 接收端测试
    └── 📄 __init__.py
```

### 🧪 测试套件
```
tests/
├── 📄 __init__.py                # 测试模块导出
├── 📄 test_integration.py        # 集成测试
└── 📁 fixtures/                  # 测试资源
    ├── 📁 test_files/            # 测试文件
    └── 📁 test_images/           # 测试图像
```

### 📚 示例代码
```
examples/
├── 📄 __init__.py                # 示例模块导出
└── 📄 basic_usage.py             # 基础使用示例
```

### 📁 输出目录
```
output/
├── 📁 sender_output/             # 发送端输出
└── 📁 receiver_output/           # 接收端输出
```

### 📄 文档目录
```
docs/
├── 📄 README.md                  # 文档首页
├── 📄 PROJECT_DESCRIPTION.md     # 项目描述
├── 📄 ARCHITECTURE.md            # 架构文档
├── 📄 DEVELOPMENT_PLAN.md        # 开发计划
├── 📄 DEVELOPMENT_LOG.md         # 开发日志
├── 📄 DEBUGGING_GUIDE.md         # 调试指南
├── 📄 TERMINOLOGY_DEFINITIONS.md   # 术语定义
├── 📄 DIRECTORY_STRUCTURE.md     # 本文件
└── 📁 development_logs/          # 日志备份
    └── 📁 backups/
```

## 🗑️ 待清理文件列表

### ❌ 备份目录（可删除）
- `backup_20250812_220308/` - 历史备份
- `__pycache__/` - Python缓存文件
- `*.pyc` - 编译后的Python文件

### ❌ 临时文件
- `cleanup_report.json` - 清理报告
- `current_session.txt` - 当前会话记录
- `module_progress.txt` - 模块进度记录

### ❌ 重复文件
- `common/color_mapper.py` - 与sender/color_mapper.py重复
- `legacy_files/` - 旧版本文件（已整合到新架构）

## 🎯 最终整合目标

整合后项目将包含：
- **7个核心模块**（发送端5个 + 核心2个）
- **1个配置文件**（config.json）
- **4个工具脚本**（开发相关）
- **3个测试目录**（单元测试 + 集成测试）
- **2个输出目录**（发送端 + 接收端）
- **8个文档文件**（完整文档体系）

## 🔄 整合步骤

1. **清理缓存文件**：删除__pycache__和.pyc文件
2. **移除备份**：删除backup_20250812_220308目录
3. **合并重复**：确认common/color_mapper.py是否可删除
4. **更新导入**：修复所有模块间的导入路径
5. **验证功能**：确保所有模块正常运行

## 📊 文件统计

| 类型 | 整合前 | 整合后 | 减少率 |
|------|--------|--------|--------|
| Python文件 | 25+ | 15 | 40% |
| 配置文件 | 5+ | 1 | 80% |
| 文档文件 | 15+ | 8 | 47% |
| 总文件数 | 60+ | 35 | 42% |

整合后项目将更加清晰、高效，便于维护和扩展。