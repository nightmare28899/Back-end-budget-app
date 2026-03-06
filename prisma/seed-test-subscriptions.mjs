import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/budgetapp?schema=public";
const adapter = new PrismaPg(new Pool({ connectionString: databaseUrl }));
const prisma = new PrismaClient({ adapter });

function daysAgo(days) {
  const value = new Date();
  value.setDate(value.getDate() - days);
  value.setHours(8, 0, 0, 0);
  return value;
}

async function main() {
  const targetEmail = process.env.TEST_SUBSCRIPTIONS_USER_EMAIL?.trim();
  const user = targetEmail
    ? await prisma.user.findUnique({
        where: { email: targetEmail.toLowerCase() },
        select: { id: true, email: true },
      })
    : await prisma.user.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, email: true },
      });

  if (!user) {
    throw new Error(
      "No users found. Create a user first or set TEST_SUBSCRIPTIONS_USER_EMAIL.",
    );
  }

  const seedPayload = [
    {
      userId: user.id,
      name: "Test Netflix Auto",
      cost: 199,
      currency: "MXN",
      billingCycle: "MONTHLY",
      nextPaymentDate: daysAgo(1),
      reminderDays: 3,
      isActive: true,
      hexColor: "#E50914",
    },
    {
      userId: user.id,
      name: "Test Gym Auto",
      cost: 120,
      currency: "MXN",
      billingCycle: "WEEKLY",
      nextPaymentDate: daysAgo(1),
      reminderDays: 2,
      isActive: true,
      hexColor: "#16A085",
    },
    {
      userId: user.id,
      name: "Test Coffee Auto",
      cost: 45,
      currency: "MXN",
      billingCycle: "DAILY",
      nextPaymentDate: daysAgo(1),
      reminderDays: 1,
      isActive: true,
      hexColor: "#8E5A3C",
    },
  ];

  await prisma.subscription.createMany({
    data: seedPayload,
  });

  console.log(
    `Inserted ${seedPayload.length} test subscriptions for ${user.email}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
