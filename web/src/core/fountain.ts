// 喷泉码（LT 码，纯 TS 自实现）：抽象 FountainEncoder 接口 + 可工作实现 + 简单剥离解码。
// 铁律：ECC 一律 RS + 喷泉；喷泉码为外层 rateless，解决块级擦除/乱序，收够任意 N+1 块即重建。
// 注：MVP 源符号 = 1 字节；生产环境按 RS_K 分块（此处保持接口一致）。

export type Rng = () => number;

function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface CodedBlock {
  seed: number;
  degree: number;
  indices: number[];
  payload: number[]; // 每个源符号 1 字节（XOR 结果）
}

export interface FountainEncoder {
  readonly sourceCount: number;
  reset(data: Uint8Array): void;
  nextBlock(): CodedBlock;
}

export class LTEncoder implements FountainEncoder {
  private data: Uint8Array = new Uint8Array(0);
  private K = 0;
  private masterSeed: number;
  private counter = 0;

  constructor(masterSeed = 1) {
    this.masterSeed = masterSeed >>> 0;
  }

  reset(data: Uint8Array): void {
    this.data = data;
    this.K = data.length;
    this.counter = 0;
  }

  get sourceCount(): number {
    return this.K;
  }

  private degree(rng: Rng): number {
    if (this.K <= 1) return 1;
    if (rng() < 0.5) return 1;
    const d = 1 + Math.floor(rng() * Math.min(this.K, 10));
    return Math.max(1, Math.min(this.K, d));
  }

  nextBlock(): CodedBlock {
    const seed = (this.masterSeed ^ Math.imul(this.counter++, 0x9e3779b1)) >>> 0;
    const rng = mulberry32(seed);
    const degree = this.degree(rng);
    const idxSet = new Set<number>();
    while (idxSet.size < degree) idxSet.add(Math.floor(rng() * this.K));
    const indices = [...idxSet];
    let acc = 0;
    for (const idx of indices) acc ^= this.data[idx];
    return { seed, degree, indices, payload: [acc] };
  }
}

export class LTDecoder {
  private source: (number | null)[];
  private blocks: { indices: number[]; payload: number; done: boolean }[];

  constructor(private K: number) {
    this.source = new Array(K).fill(null);
    this.blocks = [];
  }

  addBlock(b: CodedBlock): void {
    if (b.indices.some((i) => i >= this.K)) return;
    this.blocks.push({ indices: b.indices.slice(), payload: b.payload[0] ?? 0, done: false });
    this.process();
  }

  private process(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (const blk of this.blocks) {
        if (blk.done) continue;
        let unknown = 0;
        let unkIdx = -1;
        let acc = blk.payload;
        for (const idx of blk.indices) {
          if (this.source[idx] !== null) acc ^= this.source[idx] as number;
          else {
            unknown++;
            unkIdx = idx;
          }
        }
        if (unknown === 1) {
          this.source[unkIdx] = acc;
          blk.done = true;
          progress = true;
        } else if (unknown === 0) {
          blk.done = true;
        }
      }
    }
  }

  get haveCount(): number {
    return this.source.filter((s) => s !== null).length;
  }

  isComplete(): boolean {
    return this.source.every((s) => s !== null);
  }

  getSource(): Uint8Array {
    if (!this.isComplete()) throw new Error("LTDecoder: 源未集齐，无法重组");
    return Uint8Array.from(this.source as number[]);
  }
}

// 端到端 round-trip 校验辅助
export function fountainRoundTrip(data: Uint8Array, overheadFactor: number, seed = 7): Uint8Array {
  const enc = new LTEncoder(seed);
  enc.reset(data);
  const dec = new LTDecoder(data.length);
  const blocks = Math.ceil(data.length * overheadFactor);
  for (let i = 0; i < blocks; i++) dec.addBlock(enc.nextBlock());
  if (!dec.isComplete()) throw new Error(`fountainRoundTrip: 块不足（需更多开销，当前 ${blocks}/${data.length}）`);
  return dec.getSource();
}
