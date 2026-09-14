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

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [CardStatementsController],
  providers: [
    CardStatementsService,
    EntitlementsService,
    CardStatementProcessorService,
    PdfTextExtractor,
    BanamexStatementParser,
    RappiCardStatementParser,
    BbvaStatementParser,
  ],
  exports: [CardStatementsService],
})
export class CardStatementsModule {}
