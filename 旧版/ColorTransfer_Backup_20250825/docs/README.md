# 智能光传输系统

## 项目概述
智能光传输系统是一套创新的无接触数据传输方案，通过电脑屏幕显示彩色色块矩阵，手机摄像头拍摄并识别这些色块，实现数据从电脑到手机的无线传输。

## 技术架构
- **发送端**：数据编码、显示渲染
- **接收端**：图像采集、色块识别、数据解码

## 快速开始
1. 确保安装了必要的依赖：
   ```bash
   pip install opencv-python numpy
   ```
2. 运行发送端：
   ```bash
   python sender.py
   ```
3. 运行接收端：
   ```bash
   python receiver.py
   ```

## 项目结构
```
ColorTransfer/
├── sender.py       # 发送端主程序
├── receiver.py      # 接收端主程序
├── calibration.py  # 校准系统
├── config.json      # 配置文件
└── README.md       # 项目说明
```