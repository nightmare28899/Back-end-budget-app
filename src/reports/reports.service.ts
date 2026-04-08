import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import * as nodemailer from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";
import {
  AnalyticsService,
  type CategoryBreakdownItem,
} from "../analytics/analytics.service";
import { formatDateOnly } from "../common/budget/budget.utils";
import type {
  ReportHistoryItem,
  ReportHistorySource,
  ReportPeriodType,
  ReportSnapshot,
} from "./reports.types";

function isEnabled(rawValue: string | undefined): boolean {
  return rawValue?.trim().toLowerCase() === "true";
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function daysInRangeInclusive(start: Date, end: Date): number {
  const startUtc = Date.UTC(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());

  return Math.max(
    Math.round((endUtc - startUtc) / (24 * 60 * 60 * 1000)) + 1,
    1,
  );
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly analyticsService: AnalyticsService,
    private readonly configService: ConfigService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>("MAIL_HOST", "smtp.sendgrid.net"),
      port: parseInt(this.configService.get<string>("MAIL_PORT", "587"), 10),
      auth: {
        user: this.configService.get<string>("MAIL_USER"),
        pass: this.configService.get<string>("MAIL_PASSWORD"),
      },
    });
  }

  @Cron("0 20 * * 0")
  async sendWeeklyReports() {
    this.logger.log("Starting weekly report generation...");

    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        weeklyReportEnabled: true,
      },
      select: { id: true, email: true, name: true },
    });

    for (const user of users) {
      try {
        await this.sendReportForUser(user.id, user.email, user.name, {
          periodType: "weekly",
        });
        this.logger.log(`Weekly report sent to ${user.email}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Failed to send report to ${user.email}: ${message}`);
      }
    }
  }

  @Cron("0 20 1 * *")
  async sendMonthlyReports() {
    this.logger.log("Starting monthly report generation...");

    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        monthlyReportEnabled: true,
      },
      select: { id: true, email: true, name: true },
    });

    for (const user of users) {
      try {
        await this.sendReportForUser(user.id, user.email, user.name, {
          periodType: "monthly",
        });
        this.logger.log(`Monthly report sent to ${user.email}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Failed to send report to ${user.email}: ${message}`);
      }
    }
  }

  async getSummary(
    userId: string,
    options?: {
      periodType?: ReportPeriodType;
      referenceDate?: string;
      horizonMonths?: number;
    },
  ): Promise<ReportSnapshot> {
    const periodType = options?.periodType ?? "weekly";
    const referenceNow = this.getReferenceDate(options?.referenceDate);
    const reportWindow = this.resolveReportWindow(periodType, referenceNow);
    const from = formatDateOnly(reportWindow.start);
    const to = formatDateOnly(reportWindow.end);
    const referenceDateKey = formatDateOnly(referenceNow);

    const [
      expenses,
      incomes,
      categories,
      plan,
      categoryBudgets,
      insights,
      goals,
    ] = await Promise.all([
      this.prisma.expense.findMany({
        where: {
          userId,
          date: {
            gte: reportWindow.start,
            lte: reportWindow.end,
          },
        },
        select: {
          cost: true,
        },
      }),
      this.prisma.income.findMany({
        where: {
          userId,
          date: {
            gte: reportWindow.start,
            lte: reportWindow.end,
          },
        },
        select: {
          amount: true,
        },
      }),
      this.analyticsService.getCategoryBreakdown(userId, from, to),
      this.analyticsService.getBudgetSummary(userId, referenceDateKey),
      this.analyticsService.getCategoryBudgets(userId, referenceDateKey),
      this.analyticsService.getInsights(
        userId,
        referenceDateKey,
        options?.horizonMonths,
      ),
      this.prisma.savingsGoal.findMany({
        where: { userId },
        select: {
          id: true,
          title: true,
          targetAmount: true,
          currentAmount: true,
          targetDate: true,
        },
        orderBy: [{ targetDate: "asc" }, { createdAt: "desc" }],
      }),
    ]);

    const totalSpent = roundMoney(
      expenses.reduce((sum, expense) => sum + Number(expense.cost ?? 0), 0),
    );
    const totalIncome = roundMoney(
      incomes.reduce((sum, income) => sum + Number(income.amount ?? 0), 0),
    );
    const net = roundMoney(totalIncome - totalSpent);
    const trackedDays = daysInRangeInclusive(
      reportWindow.start,
      reportWindow.end,
    );
    const safeSavingsBase = Math.min(
      Math.max(net, 0),
      Math.max(plan.safeToSpend ?? 0, 0),
    );
    const suggestedSavingsMove = roundMoney(safeSavingsBase * 0.2);

    const totalSaved = roundMoney(
      goals.reduce((sum, goal) => sum + Number(goal.currentAmount ?? 0), 0),
    );
    const totalTarget = roundMoney(
      goals.reduce((sum, goal) => sum + Number(goal.targetAmount ?? 0), 0),
    );
    const nextGoal =
      goals.find(
        (goal) =>
          goal.targetDate &&
          endOfDay(goal.targetDate).getTime() >= reportWindow.end.getTime(),
      ) ?? null;

    return {
      generatedAt: new Date().toISOString(),
      report: {
        type: periodType,
        label: this.getReportLabel(periodType),
        referenceDate: referenceDateKey,
        start: from,
        end: to,
        trackedDays,
      },
      summary: {
        totalIncome,
        incomeCount: incomes.length,
        averageIncome:
          incomes.length > 0 ? roundMoney(totalIncome / incomes.length) : 0,
        totalSpent,
        expenseCount: expenses.length,
        averagePerDay: roundMoney(totalSpent / trackedDays),
        net,
        savingsRate:
          totalIncome > 0 ? roundPercent((net / totalIncome) * 100) : null,
      },
      plan,
      categoryBudgets: {
        overBudgetCount: categoryBudgets.overBudgetCount,
        watchCount: categoryBudgets.watchCount,
      },
      categories,
      insights,
      savings: {
        goalCount: goals.length,
        totalSaved,
        totalTarget,
        progressPercent:
          totalTarget > 0
            ? roundPercent((totalSaved / totalTarget) * 100)
            : null,
        nextGoal: nextGoal
          ? {
              id: nextGoal.id,
              title: nextGoal.title,
              targetDate: nextGoal.targetDate
                ? formatDateOnly(nextGoal.targetDate)
                : null,
              currentAmount: roundMoney(Number(nextGoal.currentAmount ?? 0)),
              targetAmount: roundMoney(Number(nextGoal.targetAmount ?? 0)),
            }
          : null,
      },
      highlights: {
        suggestedSavingsMove,
      },
    };
  }

  async saveSummary(
    userId: string,
    options?: {
      periodType?: ReportPeriodType;
      referenceDate?: string;
      horizonMonths?: number;
      source?: ReportHistorySource;
    },
  ): Promise<ReportHistoryItem> {
    const report = await this.getSummary(userId, options);
    const saved = await this.persistReportHistory(
      userId,
      report,
      options?.source ?? "manual",
    );

    return this.toHistoryItem(saved);
  }

  async getHistory(userId: string, limit = 8): Promise<ReportHistoryItem[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 30);
    const rows = await this.prisma.reportHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      select: {
        id: true,
        periodType: true,
        source: true,
        referenceDate: true,
        reportStart: true,
        reportEnd: true,
        snapshot: true,
        createdAt: true,
      },
    });

    return rows.map((row) => this.toHistoryItem(row));
  }

  async sendManualReport(
    userId: string,
    options?: {
      email?: string;
      periodType?: ReportPeriodType;
      referenceDate?: string;
      horizonMonths?: number;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) throw new NotFoundException("User not found");

    const requestedEmail = options?.email?.trim();
    const allowEmailOverride = isEnabled(
      this.configService.get<string>("ALLOW_REPORT_EMAIL_OVERRIDE", "false"),
    );
    const isOwnDestination =
      requestedEmail?.toLowerCase() === user.email.toLowerCase();

    if (requestedEmail && !isOwnDestination && !allowEmailOverride) {
      this.logger.warn(
        `Ignoring custom report destination for user ${user.id}: ALLOW_REPORT_EMAIL_OVERRIDE is disabled`,
      );
    }

    const destinationEmail =
      requestedEmail && (allowEmailOverride || isOwnDestination)
        ? requestedEmail
        : user.email;

    return this.sendReportForUser(
      user.id,
      destinationEmail,
      user.name,
      options,
    );
  }

  private async sendReportForUser(
    userId: string,
    email: string,
    name: string,
    options?: {
      periodType?: ReportPeriodType;
      referenceDate?: string;
      horizonMonths?: number;
    },
  ) {
    const report = await this.getSummary(userId, options);
    const html = this.generateEmailHtml(name, report);

    try {
      await this.transporter.sendMail({
        from: this.configService.get<string>(
          "MAIL_FROM",
          "noreply@budgetapp.com",
        ),
        to: email,
        subject: `💰 Your ${report.report.label} report (${report.report.start} - ${report.report.end})`,
        html,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown email transport error";
      this.logger.error(`Failed to send report to ${email}: ${message}`);
      throw new InternalServerErrorException(
        "Failed to send email report. Verify MAIL_* SMTP configuration.",
      );
    }

    await this.persistReportHistory(userId, report, "email");

    return { message: "Report sent successfully" };
  }

  private generateEmailHtml(name: string, report: ReportSnapshot): string {
    const categoryRows = report.categories
      .slice(0, 5)
      .map(
        (category: CategoryBreakdownItem) => `
        <tr>
          <td style="padding: 8px 16px; border-bottom: 1px solid #eee;">
            ${category.icon} ${category.name}
          </td>
          <td style="padding: 8px 16px; border-bottom: 1px solid #eee; text-align: right;">
            $${category.total.toFixed(2)}
          </td>
          <td style="padding: 8px 16px; border-bottom: 1px solid #eee; text-align: right;">
            ${category.percentage}%
          </td>
        </tr>`,
      )
      .join("");

    const topCategory = report.insights.topCategory;
    const nextGoal = report.savings.nextGoal;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
          .container { max-width: 640px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; }
          .header { background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%); padding: 32px; color: white; }
          .header h1 { margin: 0; font-size: 24px; }
          .header p { margin: 8px 0 0; opacity: 0.9; }
          .content { padding: 24px 32px; }
          .kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 20px 0; }
          .card { background: #f8fafc; border-radius: 10px; padding: 16px; }
          .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
          .value { font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 6px; }
          .muted { font-size: 13px; color: #475569; margin-top: 6px; }
          table { width: 100%; border-collapse: collapse; margin: 16px 0; }
          th { background: #f8fafc; padding: 10px 16px; text-align: left; font-size: 13px; color: #64748b; }
          .footer { padding: 16px 32px; background: #f8fafc; text-align: center; font-size: 12px; color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${report.report.label} report</h1>
            <p>${report.report.start} — ${report.report.end}</p>
          </div>
          <div class="content">
            <p>Hi ${name},</p>
            <p>Here is your finance snapshot up to ${report.report.referenceDate}.</p>

            <div class="kpis">
              <div class="card">
                <div class="label">Spent</div>
                <div class="value">$${report.summary.totalSpent.toFixed(2)}</div>
                <div class="muted">${report.summary.expenseCount} expenses • $${report.summary.averagePerDay.toFixed(2)}/day</div>
              </div>
              <div class="card">
                <div class="label">Income</div>
                <div class="value">$${report.summary.totalIncome.toFixed(2)}</div>
                <div class="muted">${report.summary.incomeCount} income entries</div>
              </div>
              <div class="card">
                <div class="label">Net</div>
                <div class="value">$${report.summary.net.toFixed(2)}</div>
                <div class="muted">Savings rate: ${report.summary.savingsRate?.toFixed(1) ?? "0.0"}%</div>
              </div>
              <div class="card">
                <div class="label">Safe move</div>
                <div class="value">$${report.highlights.suggestedSavingsMove.toFixed(2)}</div>
                <div class="muted">Conservative move to savings based on cashflow and plan room</div>
              </div>
            </div>

            <div class="card">
              <div class="label">Plan context</div>
              <div class="muted">Plan budget: $${report.plan.budgetAmount.toFixed(2)}</div>
              <div class="muted">Remaining: $${report.plan.remaining.toFixed(2)}</div>
              <div class="muted">Safe to spend: $${(report.plan.safeToSpend ?? 0).toFixed(2)}</div>
            </div>

            ${
              topCategory
                ? `
            <div class="card" style="margin-top: 12px;">
              <div class="label">Top category</div>
              <div class="value" style="font-size: 18px;">${topCategory.icon} ${topCategory.name}</div>
              <div class="muted">$${topCategory.total.toFixed(2)} • ${topCategory.percentage}% of tracked spend</div>
            </div>`
                : ""
            }

            ${
              categoryRows
                ? `
            <h3 style="margin-top: 24px;">Spending by category</h3>
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th style="text-align: right;">Amount</th>
                  <th style="text-align: right;">%</th>
                </tr>
              </thead>
              <tbody>
                ${categoryRows}
              </tbody>
            </table>`
                : ""
            }

            <div class="card" style="margin-top: 12px;">
              <div class="label">Subscriptions</div>
              <div class="muted">Monthly recurring spend: $${report.insights.subscriptionSavings.monthlyRecurringSpend.toFixed(2)}</div>
              <div class="muted">Potential savings in ${report.insights.subscriptionSavings.horizonMonths} months: $${report.insights.subscriptionSavings.projectedSavings.toFixed(2)}</div>
            </div>

            <div class="card" style="margin-top: 12px;">
              <div class="label">Savings goals</div>
              <div class="muted">Saved so far: $${report.savings.totalSaved.toFixed(2)} / $${report.savings.totalTarget.toFixed(2)}</div>
              <div class="muted">Progress: ${report.savings.progressPercent?.toFixed(1) ?? "0.0"}%</div>
              ${
                nextGoal
                  ? `<div class="muted">Next goal: ${nextGoal.title} by ${nextGoal.targetDate ?? "no date"}</div>`
                  : ""
              }
            </div>
          </div>
          <div class="footer">
            <p>BudgetApp — Your personal finance tracker</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getReferenceDate(rawDate?: string): Date {
    const now = new Date();
    const maxDate = endOfDay(now);

    if (!rawDate) {
      return maxDate;
    }

    const parsed = new Date(`${rawDate}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException("Invalid report reference date");
    }

    const normalized = endOfDay(parsed);
    if (normalized.getTime() > maxDate.getTime()) {
      throw new BadRequestException(
        "Report reference date cannot be in the future",
      );
    }

    return normalized;
  }

  private resolveReportWindow(
    periodType: ReportPeriodType,
    referenceDate: Date,
  ) {
    const end = endOfDay(referenceDate);
    const start =
      periodType === "monthly"
        ? new Date(end.getFullYear(), end.getMonth(), 1)
        : this.startOfWeek(referenceDate);

    start.setHours(0, 0, 0, 0);

    return {
      start,
      end,
    };
  }

  private startOfWeek(date: Date): Date {
    const next = startOfDay(date);
    const dayOfWeek = next.getDay();
    next.setDate(next.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    return next;
  }

  private getReportLabel(periodType: ReportPeriodType) {
    return periodType === "monthly" ? "Monthly" : "Weekly";
  }

  private async persistReportHistory(
    userId: string,
    report: ReportSnapshot,
    source: ReportHistorySource,
  ) {
    return this.prisma.reportHistory.create({
      data: {
        userId,
        periodType: report.report.type,
        source,
        referenceDate: new Date(`${report.report.referenceDate}T12:00:00`),
        reportStart: new Date(`${report.report.start}T00:00:00`),
        reportEnd: new Date(`${report.report.end}T23:59:59`),
        snapshot: report as unknown as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        periodType: true,
        source: true,
        referenceDate: true,
        reportStart: true,
        reportEnd: true,
        snapshot: true,
        createdAt: true,
      },
    });
  }

  private toHistoryItem(row: {
    id: string;
    periodType: string;
    source: string;
    referenceDate: Date;
    reportStart: Date;
    reportEnd: Date;
    snapshot: Prisma.JsonValue;
    createdAt: Date;
  }): ReportHistoryItem {
    const snapshot = row.snapshot as unknown as ReportSnapshot;

    return {
      id: row.id,
      periodType: this.normalizePeriodType(row.periodType),
      source: this.normalizeHistorySource(row.source),
      referenceDate: formatDateOnly(row.referenceDate),
      start: formatDateOnly(row.reportStart),
      end: formatDateOnly(row.reportEnd),
      createdAt: row.createdAt.toISOString(),
      summary: snapshot.summary,
    };
  }

  private normalizePeriodType(value: string): ReportPeriodType {
    return value === "monthly" ? "monthly" : "weekly";
  }

  private normalizeHistorySource(value: string): ReportHistorySource {
    return value === "email" ? "email" : "manual";
  }
}
