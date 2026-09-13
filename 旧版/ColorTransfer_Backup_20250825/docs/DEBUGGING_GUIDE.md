# 彩色数据传输系统调试指南

## 调试环境准备

1. 确保安装了必要的依赖：
   ```bash
   pip install -r requirements.txt
   ```

2. 推荐使用VS Code或PyCharm等IDE进行调试，这些工具提供了直观的调试界面和功能。

## 基本调试方法

### 1. 使用print语句调试
这是最简单直接的调试方法，适合快速定位问题。

```python
# 在sender.py中添加print语句
def create_frame(self, data_colors):
    print(f"数据色块数量: {len(data_colors)}")
    # 其他代码...
```

### 2. 使用Python内置的pdb调试器
```bash
# 在命令行中启动调试
python -m pdb file_to_color_player.py test_data.bin
```

pdb常用命令:
- `n`: 执行下一行
- `s`: 进入函数
- `r`: 执行到函数返回
- `c`: 继续执行直到下一个断点
- `p 变量名`: 打印变量值
- `b 行号`: 设置断点

### 3. 使用VS Code调试
1. 安装Python扩展
2. 点击左侧调试图标
3. 创建launch.json文件
4. 设置断点并启动调试

## 项目特定部分调试

### 1. 颜色映射调试
使用`test_color_mapping.py`验证颜色映射是否正确：

```bash
python test_color_mapping.py
```

该脚本会生成测试图像并验证RGB值是否符合公式`65 + value × 4`。

### 2. 文件拆分与播放调试

#### 调试文件拆分
```python
# 在file_to_color_player.py中添加
print(f"文件大小: {len(self.data)} 字节")
print(f"编码后数据大小: {len(self.encoded_data)} 个编码单元")
print(f"总帧数: {len(self.color_frames)}")
```

#### 调试播放过程
```python
# 在播放循环中添加
print(f"当前帧: {self.current_frame}/{len(self.color_frames)}")
```

### 3. 边框和校准色块调试
修改`sender.py`中的`create_frame`方法，添加可视化调试信息：

```python
# 绘制边框时添加标签
font = cv2.FONT_HERSHEY_SIMPLEX
cv2.putText(frame, f"上边框色块 {i}", (x+5, y+25), font, 0.5, (255, 255, 255), 1)
```

## 常见问题及解决方案

### 1. 播放时画面卡顿
- 降低帧率：`python file_to_color_player.py test_data.bin 5`
- 减少每帧的数据量：修改`sender.py`中的`block_size`参数

### 2. 颜色显示异常
- 检查`data_to_color`方法中的颜色映射公式
- 验证OpenCV与pygame的颜色空间转换是否正确

### 3. 无法全屏显示
- 检查屏幕分辨率设置：修改`config.json`中的`resolution`参数
- 确保pygame初始化时使用了`pygame.FULLSCREEN`标志

## 高级调试技巧

### 1. 使用logging模块记录详细日志
```python
import logging

# 配置日志
logging.basicConfig(level=logging.DEBUG, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('color_transfer')

# 在代码中添加日志
logger.debug(f"当前帧: {self.current_frame}")
```

### 2. 使用matplotlib可视化中间结果
```python
import matplotlib.pyplot as plt

# 可视化颜色帧
plt.imshow(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
plt.title(f"帧 {self.current_frame}")
plt.show()
```

通过以上方法，您可以系统地调试彩色数据传输系统的各个组件，定位并解决可能出现的问题。