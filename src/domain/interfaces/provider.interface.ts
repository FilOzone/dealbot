import { Hex } from "../../common/types.js";

export interface IProvider {
  address: Hex;
  serviceUrl: string;
  peerId?: number;
}

export interface IProviders extends Record<Hex, IProvider> {}
