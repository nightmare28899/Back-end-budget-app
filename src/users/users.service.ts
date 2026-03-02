import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateUserDto } from "./dto/update-user.dto";
import { StorageService } from "../storage/storage.service";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        dailyBudget: true,
        currency: true,
        createdAt: true,
      },
    });

    return this.withAvatarPresignedUrl(user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateUserDto,
    avatarFile?: Express.Multer.File,
  ) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });

    let nextAvatarKey: string | undefined;

    if (avatarFile) {
      nextAvatarKey = await this.storageService.uploadFile(
        avatarFile,
        "avatars",
      );
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...dto,
        avatarUrl: nextAvatarKey ?? undefined,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        dailyBudget: true,
        currency: true,
      },
    });

    if (
      nextAvatarKey &&
      current?.avatarUrl &&
      current.avatarUrl !== nextAvatarKey
    ) {
      try {
        await this.storageService.deleteFile(current.avatarUrl);
      } catch (error) {
        console.error(error);
      }
    }

    return this.withAvatarPresignedUrl(user);
  }

  private async withAvatarPresignedUrl<T extends { avatarUrl: string | null }>(
    user: T | null,
  ): Promise<(T & { avatarKey: string | null }) | null> {
    if (!user) {
      return null;
    }

    const avatarKey = user.avatarUrl;

    if (!avatarKey) {
      return { ...user, avatarKey: null };
    }

    try {
      const presigned = await this.storageService.getFileUrl(avatarKey);
      return { ...user, avatarUrl: presigned, avatarKey };
    } catch (error) {
      console.error("Failed to generate presigned URL for avatar:", error);
      return { ...user, avatarKey };
    }
  }
}
