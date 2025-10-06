import { Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { ProxyModule } from "../proxy/proxy.module.js";
import { HttpClientService } from "./http-client.service.js";

@Module({
  imports: [HttpModule, ProxyModule],
  providers: [HttpClientService],
  exports: [HttpClientService],
})
export class HttpClientModule {}
