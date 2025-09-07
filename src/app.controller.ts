import { Controller, Get } from "@nestjs/common";

@Controller("api")
export class AppController {
  /**
   * Health check endpoint
   * Returns the current status
   */
  @Get("health")
  getHealth() {
    return { status: "ok" };
  }
}
