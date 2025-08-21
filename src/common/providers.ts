import { IProvider, IProviders } from "../domain/interfaces/provider.interface";
import { Hex } from "./types";

export const providers: IProviders = {
  "0x9f5087a1821eb3ed8a137be368e5e451166efaae": {
    address: "0x9f5087a1821eb3ed8a137be368e5e451166efaae",
    serviceUrl: "https://yablu.net",
  },
  "0x682467D59F5679cB0BF13115d4C94550b8218CF2": {
    address: "0x682467D59F5679cB0BF13115d4C94550b8218CF2",
    serviceUrl: "https://calibnet.pspsps.io",
  },
  // "0x4A628ebAecc32B8779A934ebcEffF1646F517756": {
  //   address: "0x4A628ebAecc32B8779A934ebcEffF1646F517756",
  //   serviceUrl: "https://pdp.zapto.org",
  // },
  // "0x876730bbE4C0536aEc98C5aBd0615b39FD4C451B": {
  //   address: "0x876730bbE4C0536aEc98C5aBd0615b39FD4C451B",
  //   serviceUrl: "https://calib-pdp.duckdns.org",
  // },
  // "0x94A63883ed82968C9F1fC3E33b9928d13b824b40": {
  //   address: "0x94A63883ed82968C9F1fC3E33b9928d13b824b40",
  //   serviceUrl: "https://pdpcalib.dcentnetworks.nl",
  // },
  // "0x971bb56718bd85b1eb78a1a7d29001ca281f3ff4": {
  //   address: "0x971bb56718bd85b1eb78a1a7d29001ca281f3ff4",
  //   serviceUrl: "http://116.182.28.4:12310",
  // },
  // "0x0F96b5f075E13c3A552c1481a1Ae00f9C042d58B": {
  //   address: "0x0F96b5f075E13c3A552c1481a1Ae00f9C042d58B",
  //   serviceUrl: "https://pdp-test.thcloud.dev",
  // },
  // "0xCb9e86945cA31E6C3120725BF0385CBAD684040c": {
  //   address: "0xCb9e86945cA31E6C3120725BF0385CBAD684040c",
  //   serviceUrl: "https://caliberation-pdp.infrafolio.com/",
  // },
  // "0x12191de399B9B3FfEB562861f9eD62ea8da18AE5": {
  //   address: "0x12191de399B9B3FfEB562861f9eD62ea8da18AE5",
  //   serviceUrl: "https://techx-pdp.filecoin.no/",
  // },
  // "0x2A06D234246eD18b6C91de8349fF34C22C7268e8": {
  //   address: "0x2A06D234246eD18b6C91de8349fF34C22C7268e8",
  //   serviceUrl: "http://pdp.660688.xyz:8443/",
  // },
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
