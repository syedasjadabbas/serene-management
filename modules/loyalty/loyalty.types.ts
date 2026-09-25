type Ref = { id: string; code: string; name: string };

export interface LoyaltyTierView extends Ref {
  rank: number;
  qualifyingNights: number | null;
  qualifyingStays: number | null;
  status: "ACTIVE" | "INACTIVE";
  members: number;
}

export interface LoyaltyProgramView extends Ref {
  isExternal: boolean;
  status: "ACTIVE" | "INACTIVE";
  members: number;
  tiers: LoyaltyTierView[];
}

export interface LoyaltyOverview {
  programs: LoyaltyProgramView[];
  actions: { manage: boolean };
}

export interface LoyaltyMemberRow {
  membershipId: string;
  membershipNumber: string;
  guest: { id: string; profileNumber: string; fullName: string };
  tier: string | null;
  status: "ACTIVE" | "INACTIVE";
  pointsBalance: string;
  enrolledAt: string;
}

export interface LoyaltyMembersPage {
  items: LoyaltyMemberRow[];
  nextCursor: string | null;
}
