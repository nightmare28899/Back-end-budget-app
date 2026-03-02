import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return undefined;
}

export class QueryUsersDto {
  @ApiPropertyOptional({
    example: false,
    default: false,
    description: "Include disabled users in the response",
  })
  @Transform(({ value }) => toBoolean(value))
  @IsOptional()
  @IsBoolean()
  includeDisabled?: boolean;
}
