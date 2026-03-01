import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateCategoryDto) {
    try {
      return await this.prisma.category.create({
        data: { ...dto, userId },
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('Category already exists');
      }

      throw error;
    }
  }

  async findAll(userId: string) {
    return this.prisma.category.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, userId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, userId },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: string, userId: string, dto: UpdateCategoryDto) {
    await this.findOne(id, userId);
    return this.prisma.category.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);
    return this.prisma.category.delete({ where: { id } });
  }

  async seedDefaults(userId: string) {
    const defaults = [
      { name: 'Food', icon: '🍔', color: '#FF6B6B' },
      { name: 'Transport', icon: '🚗', color: '#4ECDC4' },
      { name: 'Shopping', icon: '🛍️', color: '#45B7D1' },
      { name: 'Entertainment', icon: '🎬', color: '#96CEB4' },
      { name: 'Health', icon: '💊', color: '#FFEAA7' },
      { name: 'Bills', icon: '📄', color: '#DDA0DD' },
      { name: 'Other', icon: '📦', color: '#95A5A6' },
    ];

    const existing = await this.prisma.category.findMany({
      where: {
        userId,
        name: { in: defaults.map((cat) => cat.name) },
      },
      select: { name: true },
    });

    const existingNames = new Set(existing.map((cat) => cat.name));
    const missingDefaults = defaults.filter(
      (cat) => !existingNames.has(cat.name),
    );

    if (missingDefaults.length > 0) {
      await this.prisma.category.createMany({
        data: missingDefaults.map((cat) => ({ ...cat, userId })),
        skipDuplicates: true,
      });
    }

    const categories = await this.findAll(userId);

    return {
      message:
        missingDefaults.length > 0
          ? 'Default categories created'
          : 'Default categories already exist',
      created: missingDefaults.length,
      existing: defaults.length - missingDefaults.length,
      total: categories.length,
      categories,
    };
  }
}
