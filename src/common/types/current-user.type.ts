export interface CurrentUserType {
  id: string;
  sessionId?: string | null;
  email: string;
  name: string;
  role: string;
  budgetAmount?: number;
  budgetPeriod?: string;
  budgetPeriodStart?: string | null;
  budgetPeriodEnd?: string | null;
  currency: string;
  isPremium?: boolean;
}
