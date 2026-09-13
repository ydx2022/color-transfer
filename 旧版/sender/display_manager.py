"""
显示管理模块 - 发送端

负责图像帧的显示、预览和保存，支持多种输出模式。

Example:
    >>> from sender.display_manager import DisplayManager
    >>> manager = DisplayManager()
    >>> manager.display_frame(frame)
"""

import cv2
import os
import time
from typing import List, Optional, Callable
import numpy as np


class DisplayManager:
    """
    显示管理器
    
    管理图像帧的显示和输出，支持：
    1. 屏幕实时显示
    2. 文件保存
    3. 预览模式
    4. 批量处理
    
    Attributes:
        window_name (str): OpenCV窗口名称
        delay_ms (int): 帧间延迟（毫秒）
        save_dir (str): 默认保存目录
    """
    
    def __init__(self, window_name: str = "ColorTransfer", delay_ms: int = 1000):
        """
        初始化显示管理器
        
        Args:
            window_name: OpenCV窗口名称
            delay_ms: 帧间延迟，默认1000毫秒
        """
        self.window_name = window_name
        self.delay_ms = delay_ms
        self.save_dir = "output"
        
        # 创建输出目录
        os.makedirs(self.save_dir, exist_ok=True)
    
    def display_frame(self, frame: np.ndarray, title: str = None, wait: bool = True) -> bool:
        """
        显示单帧图像
        
        Args:
            frame: 要显示的图像帧
            title: 窗口标题（可选）
            wait: 是否等待用户按键
            
        Returns:
            如果用户按ESC返回False，否则True
            
        Example:
            >>> import numpy as np
            >>> frame = np.zeros((600, 800, 3), dtype=np.uint8)
            >>> manager = DisplayManager()
            >>> continue_flag = manager.display_frame(frame)
        """
        if frame is None or frame.size == 0:
            print("❌ 无效的图像帧")
            return False
        
        # 使用指定标题或默认标题
        display_title = title or self.window_name
        
        try:
            cv2.imshow(display_title, frame)
            
            if wait:
                key = cv2.waitKey(self.delay_ms) & 0xFF
                return key != 27  # ESC键退出
            else:
                cv2.waitKey(1)
                return True
                
        except cv2.error as e:
            print(f"❌ 显示错误: {e}")
            return False
    
    def display_sequence(self, frames: List[np.ndarray], fps: float = 1.0, 
                        callback: Optional[Callable] = None) -> bool:
        """
        显示帧序列
        
        Args:
            frames: 图像帧列表
            fps: 帧率，默认1.0帧/秒
            callback: 每帧回调函数
            
        Returns:
            如果用户中断返回False，否则True
            
        Example:
            >>> frames = [frame1, frame2, frame3]
            >>> manager = DisplayManager()
            >>> manager.display_sequence(frames, fps=2.0)
        """
        if not frames:
            print("❌ 帧列表为空")
            return False
        
        delay = int(1000 / fps)  # 转换为毫秒
        
        try:
            for i, frame in enumerate(frames):
                if not self.display_frame(frame, wait=False):
                    return False
                
                # 执行回调
                if callback:
                    callback(i, frame)
                
                # 等待指定时间
                key = cv2.waitKey(delay) & 0xFF
                if key == 27:  # ESC键
                    return False
            
            # 最后一帧等待用户按键
            cv2.waitKey(0)
            return True
            
        except cv2.error as e:
            print(f"❌ 序列显示错误: {e}")
            return False
    
    def save_frame(self, frame: np.ndarray, filename: str, 
                  quality: int = 95) -> bool:
        """
        保存单帧图像
        
        Args:
            frame: 要保存的图像帧
            filename: 文件名（支持.jpg, .png, .bmp等格式）
            quality: JPEG质量（1-100），PNG忽略此参数
            
        Returns:
            保存是否成功
            
        Example:
            >>> frame = np.zeros((600, 800, 3), dtype=np.uint8)
            >>> manager = DisplayManager()
            >>> manager.save_frame(frame, "output/frame_001.png")
        """
        if frame is None or frame.size == 0:
            print("❌ 无效的图像帧")
            return False
        
        # 确保目录存在
        file_path = os.path.join(self.save_dir, filename)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        try:
            # 根据文件扩展名选择保存参数
            ext = os.path.splitext(filename)[1].lower()
            
            if ext == '.jpg' or ext == '.jpeg':
                cv2.imwrite(file_path, frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
            elif ext == '.png':
                cv2.imwrite(file_path, frame, [cv2.IMWRITE_PNG_COMPRESSION, 3])
            else:
                cv2.imwrite(file_path, frame)
            
            print(f"✅ 图像已保存: {file_path}")
            return True
            
        except cv2.error as e:
            print(f"❌ 保存失败: {e}")
            return False
    
    def save_sequence(self, frames: List[np.ndarray], prefix: str = "frame", 
                     format_str: str = "png", start_index: int = 0) -> List[str]:
        """
        保存帧序列
        
        Args:
            frames: 图像帧列表
            prefix: 文件名前缀
            format_str: 文件格式
            start_index: 起始索引
            
        Returns:
            保存的文件路径列表
            
        Example:
            >>> frames = [frame1, frame2, frame3]
            >>> manager = DisplayManager()
            >>> files = manager.save_sequence(frames, prefix="data_frame")
        """
        if not frames:
            print("❌ 帧列表为空")
            return []
        
        saved_files = []
        
        for i, frame in enumerate(frames):
            filename = f"{prefix}_{start_index + i:03d}.{format_str}"
            if self.save_frame(frame, filename):
                saved_files.append(os.path.join(self.save_dir, filename))
        
        return saved_files
    
    def preview_frame(self, frame: np.ndarray, scale: float = 0.5) -> bool:
        """
        预览帧（缩放显示）
        
        Args:
            frame: 要预览的图像帧
            scale: 缩放比例（0.1-1.0）
            
        Returns:
            预览是否成功
            
        Example:
            >>> frame = np.zeros((600, 800, 3), dtype=np.uint8)
            >>> manager = DisplayManager()
            >>> manager.preview_frame(frame, scale=0.3)
        """
        if frame is None or frame.size == 0:
            print("❌ 无效的图像帧")
            return False
        
        # 缩放图像
        new_width = int(frame.shape[1] * scale)
        new_height = int(frame.shape[0] * scale)
        
        if new_width < 100 or new_height < 100:
            print("⚠️ 缩放后图像过小，使用原始尺寸")
            return self.display_frame(frame)
        
        try:
            preview = cv2.resize(frame, (new_width, new_height))
            return self.display_frame(preview, title=f"{self.window_name} - Preview")
            
        except cv2.error as e:
            print(f"❌ 预览错误: {e}")
            return False
    
    def create_gif(self, frames: List[np.ndarray], output_path: str, 
                  fps: float = 1.0, loop: int = 0) -> bool:
        """
        创建GIF动画
        
        Args:
            frames: 图像帧列表
            output_path: 输出GIF路径
            fps: 帧率
            loop: 循环次数（0=无限循环）
            
        Returns:
            创建是否成功
            
        Example:
            >>> frames = [frame1, frame2, frame3]
            >>> manager = DisplayManager()
            >>> manager.create_gif(frames, "output/animation.gif", fps=2.0)
        """
        try:
            import imageio
            
            if not frames:
                print("❌ 帧列表为空")
                return False
            
            # 转换颜色空间（BGR→RGB）
            rgb_frames = [cv2.cvtColor(frame, cv2.COLOR_BGR2RGB) for frame in frames]
            
            # 保存GIF
            duration = 1.0 / fps
            imageio.mimsave(output_path, rgb_frames, duration=duration, loop=loop)
            
            print(f"✅ GIF已创建: {output_path}")
            return True
            
        except ImportError:
            print("❌ 需要安装imageio库: pip install imageio")
            return False
        except Exception as e:
            print(f"❌ GIF创建失败: {e}")
            return False
    
    def close(self):
        """关闭所有OpenCV窗口"""
        try:
            cv2.destroyAllWindows()
        except cv2.error:
            pass
    
    def __enter__(self):
        """上下文管理器入口"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """上下文管理器出口"""
        self.close()
    
    def get_display_info(self) -> dict:
        """
        获取显示信息
        
        Returns:
            显示配置信息
            
        Example:
            >>> manager = DisplayManager()
            >>> info = manager.get_display_info()
            >>> print(info['save_dir'])  # 'output'
        """
        return {
            'window_name': self.window_name,
            'delay_ms': self.delay_ms,
            'save_dir': self.save_dir,
            'opencv_available': True,  # 假设已安装
            'supported_formats': ['jpg', 'png', 'bmp', 'tiff']
        }