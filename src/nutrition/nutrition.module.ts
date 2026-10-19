import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { StorageModule } from "../storage/storage.module";
import {
  DIET_IMPORT_CLIENT,
  DietImportService,
  createDietImportClient,
} from "./diet-import/diet-import.service";
import { RecipeSuggestionsService } from "./recipe-suggestions/recipe-suggestions.service";
import { NutritionController } from "./nutrition.controller";
import { NutritionService } from "./nutrition.service";

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [NutritionController],
  providers: [
    NutritionService,
    DietImportService,
    RecipeSuggestionsService,
    { provide: DIET_IMPORT_CLIENT, useFactory: createDietImportClient },
  ],
})
export class NutritionModule {}
