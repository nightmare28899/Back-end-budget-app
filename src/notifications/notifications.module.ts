import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { FirebaseAdminModule } from "../firebase/firebase.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [PrismaModule, FirebaseAdminModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
