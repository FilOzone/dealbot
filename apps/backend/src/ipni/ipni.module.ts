import { Module } from "@nestjs/common";
import { IpniVerificationService } from "./ipni-verification.service.js";

@Module({
  providers: [IpniVerificationService],
  exports: [IpniVerificationService],
})
export class IpniModule {}
