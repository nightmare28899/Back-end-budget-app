import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { IncomesController } from "./incomes.controller";
import { IncomesService } from "./incomes.service";

@Module({
  imports: [PrismaModule],
  controllers: [IncomesController],
  providers: [IncomesService],
  exports: [IncomesService],
})
export class IncomesModule {}
