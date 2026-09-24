export interface GuestSummaryView {
  id: string;
  profileNumber: string;
  title: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  nationalityCode: string | null;
  vip: { code: string; name: string } | null;
  isRestricted: boolean;
}
