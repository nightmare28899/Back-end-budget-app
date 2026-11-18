import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";
import { LegalService, PRIVACY_POLICY_VERSION } from "./legal.service";

class AccountDeletionRequestDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

@Controller("legal")
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  @Get("privacy")
  getPrivacyPolicy() {
    return {
      version: PRIVACY_POLICY_VERSION,
      effectiveAt: PRIVACY_POLICY_VERSION,
      title: "BudgetApp Privacy Policy",
      contact: process.env.PRIVACY_CONTACT_EMAIL ?? "privacy@example.com",
      sections: [
        { title: "Data we collect", body: "Account and financial records you enter, device notification tokens, and technical logs needed to operate the service." },
        { title: "Your choices", body: "You may request export or permanent deletion of your account and associated data." },
        { title: "Retention", body: "Data is retained only as needed to provide the service, meet legal obligations, or resolve disputes." },
      ],
    };
  }

  @Post("account-deletion-requests")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestDeletion(@Body() dto: AccountDeletionRequestDto) {
    return this.legalService.requestAccountDeletion(dto.email, dto.reason);
  }
}
