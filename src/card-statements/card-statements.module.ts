import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { StorageModule } from "../storage/storage.module";
import { CardStatementsController } from "./card-statements.controller";
import { CardStatementsService } from "./card-statements.service";

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [CardStatementsController],
  providers: [CardStatementsService],
  exports: [CardStatementsService],
})
export class CardStatementsModule {}
