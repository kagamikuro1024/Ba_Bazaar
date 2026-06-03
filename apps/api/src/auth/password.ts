import { compare, hash } from 'bcryptjs';

const passwordRounds = 10;

export function hashPassword(password: string) {
  return hash(password, passwordRounds);
}

export function verifyPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}
