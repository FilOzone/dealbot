import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ProxyService } from "./proxy.service.js";

@Module({
  imports: [ConfigModule],
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
