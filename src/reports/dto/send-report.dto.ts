import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsOptional } from "class-validator";
import { ReportSummaryQueryDto } from "./report-summary-query.dto";

export class SendReportDto extends ReportSummaryQueryDto {
  @ApiPropertyOptional({
    example: "receiver@example.com",
    description:
      "Optional destination email. If omitted, the report is sent to the current user email.",
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
