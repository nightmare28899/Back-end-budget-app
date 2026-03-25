export interface CurrentUserType {
  id: string;
  email: string;
  name: string;
  role: string;
  dailyBudget?: number;
  budgetAmount?: number;
  budgetPeriod?: string;
  budgetPeriodStart?: string | null;
  budgetPeriodEnd?: string | null;
  currency: string;
  isPremium?: boolean;
}
