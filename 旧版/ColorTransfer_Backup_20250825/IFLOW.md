# 彩色数据传输系统 - iFlow 上下文指南

## 项目概述

**彩色数据传输系统**是一个创新的无接触数据传输解决方案，通过将二进制数据编码为RGB彩色图像，实现从电脑屏幕到手机摄像头的无线数据传输。项目专为14岁开发者设计，包含完整的开发计划和教学指导。

### 核心技术栈
- **编程语言**: Python 3.8+
- **核心库**: OpenCV, NumPy, Pillow, Matplotlib
- **测试框架**: pytest
- **开发工具**: VS Code, 开发日志系统

### 系统架构
```
发送端 (电脑) → 数据编码 → 颜色映射 → 屏幕显示
接收端 (手机) → 摄像头捕获 → 颜色识别 → 数据解码
```

## 项目结构

```
ColorTransfer/
├── core/                 # 核心算法模块
│   ├── hamming.py       # (11,15)汉明码编解码器
│   ├── encoder.py       # 数据编码器
│   ├── decoder.py       # 数据解码器
│   └── __init__.py      # 模块初始化
├── sender/              # 发送端模块
│   ├── color_mapper.py  # 颜色映射功能
│   ├── data_encoder.py  # 数据编码
│   ├── display_manager.py # 显示管理
│   └── frame_generator.py # 帧生成器
├── receiver/            # 接收端模块
├── config/              # 配置文件
│   └── config.json      # 系统配置
├── docs/                # 文档目录
│   ├── DEVELOPMENT_PLAN.md # 8周开发计划
│   └── development_logs/   # 开发日志
├── examples/            # 示例代码
├── tests/               # 测试文件
└── 工具脚本
    ├── development_logger.py # 开发日志记录器
    ├── task_manager.py      # 任务管理
    └── next_task.py         # 任务切换
```

## 环境配置

### 依赖安装
```bash
# 安装所有依赖
pip install -r requirements.txt

# 主要依赖包
opencv-python>=4.8.0
numpy>=1.21.0
Pillow>=8.0.0
matplotlib>=3.5.0
pytest>=6.0.0
```

### 配置说明
配置文件 `config/config.json` 包含：
- 训练参数 (batch_size, epochs, learning_rate)
- 硬件配置 (分辨率、刷新率)
- 颜色映射参数 (base_value, max_value, num_levels)
- 数据传输参数 (block_size, parity_bits, grid_dimensions)

## 核心功能模块

### 1. 汉明码编解码 (core/hamming.py)
- 实现(11,15)汉明码，支持单比特错误纠正
- 包含生成矩阵和校验矩阵
- 支持批量编码和解码

### 2. 数据编码器 (core/encoder.py)
- 将二进制数据转换为编码格式
- 添加汉明码校验位
- 计算CRC32校验和

### 3. 数据解码器 (core/decoder.py)
- 从编码数据中提取原始数据
- 实现错误检测和纠正
- 支持汉明码纠错

### 4. 颜色映射 (sender/color_mapper.py)
- 将编码数据映射到RGB颜色空间
- 支持多种色彩映射方案
- 适应不同传输环境

## 开发工具

### 开发日志系统 (development_logger.py)
```bash
# 查看今日任务
python development_logger.py

# 开始记录开发时间
python development_logger.py --start

# 结束记录并生成日志
python development_logger.py --end --task "任务描述" --done "完成情况" --progress 50

# 快速完成任务
python development_logger.py --complete "完成描述"

# 交互式任务管理
python development_logger.py --interactive
```

### 任务管理工具
```bash
# 查看任务列表
python task_manager.py

# 完成任务并开始下一个
python task_manager.py next

# 快速完成任务
python task_manager.py quick "完成描述"

# 一键任务切换
python next_task.py
```

## 构建和运行

### 测试核心功能
```bash
# 测试汉明码编解码
python -c "from core.hamming import HammingCodec; h = HammingCodec(); test_data = 0b10101010101; encoded = h.encode(test_data); decoded, err, corr = h.decode(encoded); print(f'测试结果: {\"通过\" if test_data == decoded else \"失败\"}')"

# 运行单元测试
pytest tests/
```

### 开发阶段任务
根据 `docs/DEVELOPMENT_PLAN.md` 的8周计划：
1. **阶段1** (第1-3周): Python基础和环境搭建
2. **阶段2** (第4-6周): 发送端开发和分页设计
3. **阶段3** (第7-8周): 接收端基础开发
4. **阶段4** (第9-11周): 动态分页传输实现
5. **阶段5** (第12-14周): 模型训练和优化
6. **阶段6** (第15周): 系统整合和测试

## 开发约定

### 代码风格
- 使用Python PEP8编码规范
- 所有函数和类都需要docstring文档
- 模块化的代码结构，便于维护和扩展

### 测试要求
- 为每个核心功能编写单元测试
- 使用pytest测试框架
- 测试覆盖率目标 > 80%

### 日志记录
- 使用内置开发日志系统记录进度
- 每日记录开发时间和完成情况
- 记录遇到的问题和解决方案

## 故障排除

### 常见问题
1. **依赖安装失败**: 检查Python版本和网络连接
2. **汉明码测试失败**: 检查矩阵乘法实现
3. **颜色映射异常**: 验证RGB值范围
4. **开发日志错误**: 检查文件权限和路径

### 调试技巧
- 使用 `development_logger.py --interactive` 进行交互式调试
- 查看 `docs/development_logs/` 中的日志文件
- 使用pytest的详细输出模式 `pytest -v`

## 扩展开发

### 待实现功能
- [ ] 完整的发送端界面 (Pygame)
- [ ] 接收端图像捕获 (OpenCV)
- [ ] 机器学习模型集成
- [ ] 实时数据传输优化
- [ ] 图形用户界面 (GUI)

### 性能优化方向
- 多线程处理大数据传输
- GPU加速图像处理
- 流式数据传输协议
- 自适应颜色映射算法

---

*本文件最后更新: 2025年8月24日*
*项目版本: 1.0.0*
*开发团队: ColorTransfer Team*