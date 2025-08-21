import { IProvider, IProviders } from "../domain/interfaces/provider.interface.js";
import { Hex } from "./types.js";

export const providers: IProviders = {
  "0xa3971A7234a3379A1813d9867B531e7EeB20ae07": {
    address: "0xa3971A7234a3379A1813d9867B531e7EeB20ae07",
    serviceUrl: "https://calib.ezpdpz.net/",
  },
  "0x682467D59F5679cB0BF13115d4C94550b8218CF2": {
    address: "0x682467D59F5679cB0BF13115d4C94550b8218CF2",
    serviceUrl: "https://calibnet.pspsps.io",
  },
};

export const getProvider = (address: Hex): IProvider => {
  const provider = providers[address];
  if (!provider) {
    throw new Error(`Provider not found for address: ${address}`);
  }
  return provider;
};

export const getProviderCount = (): number => {
  return Object.keys(providers).length;
};
