// 回归测试用的固定载荷：SendPage 演示模式与离线解码脚本共用，保证真机照片能与真值逐格比对。
export const DEMO_PAYLOAD = new TextEncoder().encode(
  "ColorTransfer · opti-link 演示帧 — 屏幕色块到手机摄像头的数据传输（固定载荷，供离线回归比对）"
);
