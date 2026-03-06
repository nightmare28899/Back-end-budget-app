import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import * as nodemailer from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";
import {
  AnalyticsService,
  CategoryBreakdownItem,
  WeeklySummary,
} from "../analytics/analytics.service";
import { getBudgetPeriodLabel } from "../common/budget/budget.utils";

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
      select: { id: true, email: true, name: true },
    });

    for (const user of users) {
      try {
        await this.sendReportForUser(user.id, user.email, user.name);
        this.logger.log(`Weekly report sent to ${user.email}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Failed to send report to ${user.email}: ${message}`);
      }
    }
  }

  async sendReportForUser(userId: string, email: string, name: string) {
    const summary = await this.analyticsService.getBudgetSummary(userId);
    const categories = await this.analyticsService.getCategoryBreakdown(
      userId,
      summary.period.start,
      summary.period.end,
    );

    const html = this.generateEmailHtml(name, summary, categories);
    const periodLabel = this.getReportPeriodLabel(summary.period.type);

    try {
      await this.transporter.sendMail({
        from: this.configService.get<string>(
          "MAIL_FROM",
          "noreply@budgetapp.com",
        ),
        to: email,
        subject: `💰 Your ${periodLabel} Budget Report (${summary.period.start} - ${summary.period.end})`,
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

    return { message: "Report sent successfully" };
  }

  async sendManualReport(userId: string, targetEmail?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) throw new NotFoundException("User not found");

    const destinationEmail = targetEmail?.trim() || user.email;
    return this.sendReportForUser(user.id, destinationEmail, user.name);
  }

  private generateEmailHtml(
    name: string,
    summary: WeeklySummary,
    categories: CategoryBreakdownItem[],
  ): string {
    const periodLabel = this.getReportPeriodLabel(summary.period.type);
    const categoryRows = categories
      .map(
        (c) => `
        <tr>
          <td style="padding: 8px 16px; border-bottom: 1px solid #eee;">
            ${c.icon} ${c.name}
          </td>
          <td style="padding: 8px 16px; border-bottom: 1px solid #eee; text-align: right;">
            $${c.total.toFixed(2)}
          </td>
          <td style="padding: 8px 16px; border-bottom: 1px solid #eee; text-align: right;">
            ${c.percentage}%
          </td>
        </tr>`,
      )
      .join("");

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px; color: white; }
          .header h1 { margin: 0; font-size: 24px; }
          .header p { margin: 8px 0 0; opacity: 0.9; }
          .content { padding: 24px 32px; }
          .stats { display: flex; gap: 16px; margin: 16px 0; }
          .stat-card { flex: 1; background: #f8f9fa; border-radius: 8px; padding: 16px; text-align: center; }
          .stat-card .value { font-size: 24px; font-weight: bold; color: #333; }
          .stat-card .label { font-size: 12px; color: #666; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin: 16px 0; }
          th { background: #f8f9fa; padding: 10px 16px; text-align: left; font-size: 13px; color: #666; }
          .footer { padding: 16px 32px; background: #f8f9fa; text-align: center; font-size: 12px; color: #999; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💰 ${periodLabel} Budget Report</h1>
            <p>${summary.period.start} — ${summary.period.end}</p>
          </div>
          <div class="content">
            <p>Hi ${name},</p>
            <p>Here's your spending summary for this budget period:</p>
            
            <table>
              <tr>
                <td style="padding: 8px 0;"><strong>Total Spent</strong></td>
                <td style="padding: 8px 0; text-align: right; font-size: 20px; font-weight: bold; color: ${summary.remaining >= 0 ? "#27ae60" : "#e74c3c"};">
                  $${summary.totalSpent.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">${periodLabel} Budget</td>
                <td style="padding: 8px 0; text-align: right;">$${summary.budgetAmount.toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">Remaining</td>
                <td style="padding: 8px 0; text-align: right; color: ${summary.remaining >= 0 ? "#27ae60" : "#e74c3c"};">
                  $${summary.remaining.toFixed(2)}
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">Daily Average</td>
                <td style="padding: 8px 0; text-align: right;">$${summary.dailyAverage.toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;">Total Expenses</td>
                <td style="padding: 8px 0; text-align: right;">${summary.expenseCount}</td>
              </tr>
            </table>

            ${
              categories.length > 0
                ? `
            <h3 style="margin-top: 24px;">Spending by Category</h3>
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
          </div>
          <div class="footer">
            <p>BudgetApp — Your personal finance tracker</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private getReportPeriodLabel(period: WeeklySummary["period"]["type"]) {
    return getBudgetPeriodLabel(period);
  }
}
