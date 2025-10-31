import type { CID } from "multiformats";

export type Hex = `0x${string}`;

export type Network = "mainnet" | "calibration";

export interface DataFile {
  name: string;
  data: Buffer;
  size: number;
}

export interface CarDataFile {
  carData: Uint8Array;
  rootCID: CID;
  blockCIDs: CID[];
  blockCount: number;
  totalBlockSize: number;
  carSize: number;
}
