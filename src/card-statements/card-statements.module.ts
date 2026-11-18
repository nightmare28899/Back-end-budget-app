import { Module } from "@nestjs/common";
import { EntitlementsService } from "../common/entitlements/entitlements.service";
import { PrismaModule } from "../prisma/prisma.module";
import { StorageModule } from "../storage/storage.module";
import { CardStatementsController } from "./card-statements.controller";
import { CardStatementsService } from "./card-statements.service";
import { CardStatementProcessorService } from "./card-statement-processor.service";
import { PdfTextExtractor } from "./extractors/pdf-text.extractor";
import { BanamexStatementParser } from "./parsers/banamex/banamex-statement.parser";
import { BbvaStatementParser } from "./parsers/bbva/bbva-statement.parser";
import { RappiCardStatementParser } from "./parsers/rappicard/rappicard-statement.parser";
import { StatementPaymentsController } from "./statement-payments.controller";
import { StatementPaymentsService } from "./statement-payments.service";

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [CardStatementsController, StatementPaymentsController],
  providers: [
    CardStatementsService,
    EntitlementsService,
    CardStatementProcessorService,
    PdfTextExtractor,
    BanamexStatementParser,
    RappiCardStatementParser,
    BbvaStatementParser,
    StatementPaymentsService,
  ],
  exports: [CardStatementsService, StatementPaymentsService],
})
export class CardStatementsModule {}
