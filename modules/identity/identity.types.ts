export interface LoginResult {
  user: { id: string; displayName: string; email: string };
}

export interface SessionView {
  id: string;
  current: boolean;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}
