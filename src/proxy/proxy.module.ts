import { Module } from "@nestjs/common";
import { ProxyService } from "./proxy.service.js";
import { ConfigModule } from "@nestjs/config";

@Module({
  imports: [ConfigModule],
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
