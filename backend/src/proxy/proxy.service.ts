import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { IConfig, IProxyConfig } from "../config/app.config.js";
import type { ProxyConfig } from "./types.js";

@Injectable()
export class ProxyService {
  private proxies: ProxyConfig[] = [];
  private currentIndex = 0;

  constructor(private readonly configService: ConfigService<IConfig, true>) {
    this.initializeProxies();
  }

  private initializeProxies(): void {
    const proxyList = this.configService.get<IProxyConfig>("proxy");

    this.proxies = proxyList.list.map((proxy, index) => ({
      url: proxy,
      location: proxyList.locations[index] ? proxyList.locations[index] : undefined,
      failureCount: 0,
    }));
  }

  getRandomProxy(): string | null {
    if (this.proxies.length === 0) return null;

    this.currentIndex = Math.floor(Math.random() * this.proxies.length);
    return this.proxies[this.currentIndex].url;
  }
}
