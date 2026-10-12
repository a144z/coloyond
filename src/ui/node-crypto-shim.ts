// Browser stand-in for node:crypto.
//
// The web bundle reaches exactly one node:crypto call:
// packages/etf-client/src/weights.ts derives the Anchor instruction
// discriminators with createHash("sha256") at module load. Vite externalizes
// node:crypto for browser builds, so that call threw at import time and left
// every route (/, /app, /prototype, /etf-devnet) with an empty #root.
//
// vite.config.ts aliases node:crypto to this module for browser builds only.
// The hash is backed by @noble/hashes, which is already a dependency.
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";

type HashAlgorithm = "sha256" | "sha512";

function digestFn(algorithm: string) {
  if (algorithm === "sha256") return sha256;
  if (algorithm === "sha512") return sha512;
  throw new Error(`node:crypto shim: unsupported algorithm "${algorithm}"`);
}

class BrowserHash {
  private readonly algorithm: HashAlgorithm;
  private readonly chunks: Uint8Array[] = [];

  constructor(algorithm: string) {
    this.algorithm = algorithm === "sha512" ? "sha512" : "sha256";
    digestFn(this.algorithm);
  }

  update(data: string | Uint8Array): this {
    this.chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data);
    return this;
  }

  digest(): Uint8Array;
  digest(encoding: "hex"): string;
  digest(encoding?: "hex"): Uint8Array | string {
    const total = this.chunks.reduce((n, chunk) => n + chunk.length, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    const out = digestFn(this.algorithm)(joined);
    if (encoding === "hex") {
      return Array.from(out, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return out;
  }
}

export function createHash(algorithm = "sha256"): BrowserHash {
  return new BrowserHash(algorithm);
}
