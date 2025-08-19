import { Hex } from "../../common/types";

export interface IProvider {
  address: Hex;
  serviceUrl: string;
  peerId?: number;
}

export interface IProviders extends Record<Hex, IProvider> {}
