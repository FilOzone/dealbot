import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

@Injectable()
export class PullPieceThrottlerGuard extends ThrottlerGuard {
  protected async throwThrottlingException(context: ExecutionContext): Promise<void> {
    const res = context.switchToHttp().getResponse();
    res.status(429).setHeader("Retry-After", "60").send("Too many requests");
  }
}
