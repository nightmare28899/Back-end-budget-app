import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PaymentMethod } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCreditCardDto } from "./dto/create-credit-card.dto";
import { UpdateCreditCardDto } from "./dto/update-credit-card.dto";
import { QueryCreditCardsDto } from "./dto/query-credit-cards.dto";
import { creditCardPublicSelect } from "./credit-card.select";
import { isCreditCardPaymentMethod } from "../common/payments/payment-method.utils";

@Injectable()
export class CreditCardsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateCreditCardDto) {
    return this.prisma.creditCard.create({
      data: {
        userId,
        name: dto.name,
        bank: dto.bank,
        brand: dto.brand,
        last4: dto.last4,
        color: dto.color,
        creditLimit: dto.creditLimit,
        closingDay: dto.closingDay,
        paymentDueDay: dto.paymentDueDay,
        isActive: dto.isActive ?? true,
      },
      select: creditCardPublicSelect,
    });
  }

  async findAll(userId: string, query?: QueryCreditCardsDto) {
    return this.prisma.creditCard.findMany({
      where: {
        userId,
        ...(query?.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }, { createdAt: "desc" }],
      select: creditCardPublicSelect,
    });
  }

  async findOne(id: string, userId: string, includeInactive = true) {
    const card = await this.prisma.creditCard.findFirst({
      where: {
        id,
        userId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      select: creditCardPublicSelect,
    });

    if (!card) {
      throw new NotFoundException("Credit card not found");
    }

    return card;
  }

  async update(id: string, userId: string, dto: UpdateCreditCardDto) {
    await this.findOne(id, userId);

    return this.prisma.creditCard.update({
      where: { id },
      data: {
        name: dto.name,
        bank: dto.bank,
        brand: dto.brand,
        last4: dto.last4,
        color: dto.color,
        creditLimit: dto.creditLimit,
        closingDay: dto.closingDay,
        paymentDueDay: dto.paymentDueDay,
        isActive: dto.isActive,
      },
      select: creditCardPublicSelect,
    });
  }

  async deactivate(id: string, userId: string) {
    await this.findOne(id, userId);

    return this.prisma.creditCard.update({
      where: { id },
      data: { isActive: false },
      select: creditCardPublicSelect,
    });
  }

  async resolveLinkedCreditCardId(params: {
    userId: string;
    paymentMethod?: PaymentMethod | string | null;
    creditCardId?: string | null;
    existingCreditCardId?: string | null;
  }): Promise<string | null> {
    if (!isCreditCardPaymentMethod(params.paymentMethod)) {
      return null;
    }

    const cardId = params.creditCardId ?? params.existingCreditCardId ?? null;

    if (!cardId) {
      throw new BadRequestException(
        "creditCardId is required when paymentMethod is CREDIT_CARD",
      );
    }

    await this.assertAssignableCard(params.userId, cardId, {
      allowInactive: params.existingCreditCardId === cardId,
    });

    return cardId;
  }

  private async assertAssignableCard(
    userId: string,
    creditCardId: string,
    options?: { allowInactive?: boolean },
  ) {
    const card = await this.prisma.creditCard.findFirst({
      where: {
        id: creditCardId,
        userId,
      },
      select: {
        id: true,
        isActive: true,
      },
    });

    if (!card) {
      throw new BadRequestException("Selected credit card is not available");
    }

    if (!options?.allowInactive && !card.isActive) {
      throw new BadRequestException("Selected credit card is inactive");
    }
  }
}
