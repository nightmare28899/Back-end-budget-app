import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional } from 'class-validator';

export class SendWeeklyReportDto {
  @ApiPropertyOptional({
    example: 'receiver@example.com',
    description:
      'Optional destination email. If omitted, the report is sent to the current user email.',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
