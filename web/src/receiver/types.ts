// 接收端共享类型（纯 TS、零 DOM）。RGBA 图像抽象，浏览器与 Node 离线脚本共用。

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // 长度 = width*height*4，RGBA
}

export interface Anchor {
  cx: number; // 质心 x（图像像素）
  cy: number; // 质心 y（图像像素）
  area: number; // 连通域面积（像素）
}

// 单格解码结果
export interface DecodedCell {
  symbolIdx: number;
  colorIdx: number;
  value: number; // 组合整数（decodeCell）
  colorConf: number; // 0..1，越大越可信
  symbolConf: number; // 0..1
  isData: boolean;
}

export interface DecodedFrame {
  cols: number;
  rows: number;
  rotation: number; // 检测到的旋转角（度，0/90/180/270）
  values: Int16Array; // 与 CellFrame.values 对齐；-1 = 非数据格
  cellMeta: Uint8Array;
  cells: (DecodedCell | null)[]; // 每格明细，null = 非数据格
}
