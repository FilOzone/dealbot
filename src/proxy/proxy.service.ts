import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IConfig, IProxyConfig } from "src/config/app.config.js";
import { ProxyConfig } from "./types.js";

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private proxies: ProxyConfig[] = [];
  private currentIndex = 0;

  constructor(private readonly configService: ConfigService<IConfig, true>) {
    this.initializeProxies();
  }

  private initializeProxies(): void {
    const proxyList = this.configService.get<IProxyConfig>("proxy");

    if (proxyList.hosts.length !== proxyList.ports.length) {
      throw new Error("Proxy hosts and ports must have the same length");
    }

    const username = proxyList.username;
    const password = proxyList.password;

    this.proxies = proxyList.hosts.map((host, index) => ({
      url: `http://${username}:${password}@${host}:${proxyList.ports[index]}`,
      location: proxyList.locations[index],
      failureCount: 0,
    }));
  }

  getRandomProxy(): string | null {
    if (this.proxies.length === 0) return null;

    this.currentIndex = Math.floor(Math.random() * this.proxies.length);
    return this.proxies[this.currentIndex].url;
  }
}
