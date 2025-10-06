import { Module } from "@nestjs/common";
import { HttpClientService } from "./http-client.service.js";

@Module({
  providers: [HttpClientService],
  exports: [HttpClientService],
})
export class HttpClientModule {}
