import { UserRole } from '@prisma/client';

export type AccessTokenPayload = {
  sub: string;
  role: UserRole;
  email: string;
};

export type AuthenticatedUserView = {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  avatar_url: string | null;
};
