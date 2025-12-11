import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { ProxyModule } from "../proxy/proxy.module.js";
import { HttpClientService } from "./http-client.service.js";

@Module({
  imports: [HttpModule, ProxyModule],
  providers: [HttpClientService],
  exports: [HttpClientService],
})
export class HttpClientModule {}
