import { Buffer } from "buffer";

const g = globalThis as unknown as {
  Buffer: typeof Buffer;
  global: typeof globalThis;
  process: { env: Record<string, string | undefined> };
};

g.Buffer = g.Buffer ?? Buffer;
g.global = g.global ?? globalThis;
g.process = g.process ?? { env: {} };

export {};
