// 块重组（纯 TS、零 DOM）：包装 LT 解码器，跟踪「收够即停」进度并重组文件。
import { LTDecoder, type CodedBlock } from "./fountain.ts";

export class BlockReassembler {
  private dec: LTDecoder;

  constructor(public readonly total: number) {
    this.dec = new LTDecoder(total);
  }

  addBlock(b: CodedBlock): void {
    this.dec.addBlock(b);
  }

  get haveCount(): number {
    return this.dec.haveCount;
  }

  get progress(): number {
    return this.total === 0 ? 1 : this.dec.haveCount / this.total;
  }

  isComplete(): boolean {
    return this.dec.isComplete();
  }

  assemble(): Uint8Array {
    return this.dec.getSource();
  }
}
