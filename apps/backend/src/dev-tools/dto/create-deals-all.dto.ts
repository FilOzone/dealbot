import { ApiProperty } from "@nestjs/swagger";
import { TriggerDealResponseDto } from "./trigger-deal.dto.js";

export class CreateDealsAllResponseDto {
  @ApiProperty({
    description: "Deals created for all providers",
    type: [TriggerDealResponseDto],
  })
  deals: TriggerDealResponseDto[];

  @ApiProperty({ description: "Total number of deals created" })
  total: number;
}
