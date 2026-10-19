import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import {
  DetectedPurchaseConfidence,
  DetectedPurchaseStatus,
} from "@prisma/client";
import { CreateExpenseDto } from "../../expenses/dto/create-expense.dto";

export class SyncPurchaseDto {
  @IsUUID() id: string;
  @IsString() @IsNotEmpty() @MaxLength(256) fingerprint: string;
  @IsString() @IsNotEmpty() @MaxLength(255) sourcePackage: string;
  @IsInt() @Min(1) @Max(9999999999) amountCents: number;
  @IsString() @Matches(/^[A-Z]{3}$/) currency: string;
  @IsOptional() @IsString() @MaxLength(120) merchant?: string | null;
  @IsInt() @Min(0) @Max(8640000000000000) occurredAtMillis: number;
  @IsEnum(DetectedPurchaseConfidence) confidence: DetectedPurchaseConfidence;
  @IsOptional() @IsString() @MaxLength(256) possibleDuplicateOf?: string | null;
  @Transform(({ obj, key }) => (obj as Record<string, unknown>)[key])
  @IsBoolean()
  mayBeRegistered: boolean;
}
export class SyncDetectedPurchasesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SyncPurchaseDto)
  purchases: SyncPurchaseDto[];
}
export class QueryDetectedPurchasesDto {
  @IsOptional()
  @IsEnum(DetectedPurchaseStatus)
  status?: DetectedPurchaseStatus = DetectedPurchaseStatus.PENDING;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number =
    20;
}
export class ConfirmDetectedPurchaseDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CreateExpenseDto)
  expense: CreateExpenseDto;
}
export class DiscardDetectedPurchaseDto {}
