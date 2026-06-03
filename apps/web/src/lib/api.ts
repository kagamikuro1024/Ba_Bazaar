export type UserRole = 'BA_MANAGER' | 'PM_PO' | 'BA' | 'ADMIN';
export type BAStatus = 'ACTIVE' | 'ON_LEAVE' | 'RESIGNED';
export type BALevel = 'JUNIOR' | 'MIDDLE' | 'SENIOR' | 'LEAD';
export type BookingStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';
export type BookingPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type RequestType = 'SPECIFIC_BA' | 'OPEN_REQUEST';
export type ManagerRequestState =
  | 'PENDING'
  | 'NEEDS_ASSIGNMENT'
  | 'NEED_VERIFICATION'
  | 'APPROVED'
  | 'REJECTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export type SkillTag = {
  id: string;
  name: string;
  group: 'DOMAIN' | 'ANALYSIS_SKILL';
  status: string;
};

export type BAProfile = {
  id: string;
  user_id?: string | null;
  full_name: string;
  email?: string;
  phone?: string | null;
  level: BALevel;
  joined_date?: string;
  avatar_url?: string | null;
  status: BAStatus;
  status_reason?: string | null;
  skill_tags: { id: string; tag: SkillTag }[];
  bookings?: Booking[];
};

export type Project = {
  id: string;
  name: string;
  color: string;
  description?: string | null;
};

export type User = {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  avatar_url?: string | null;
};

export type Booking = {
  id: string;
  ba_id: string | null;
  project_id: string;
  requester_id: string;
  manager_id?: string | null;
  title: string;
  description: string;
  notes?: string | null;
  start_date: string;
  end_date: string;
  capacity_percent: number;
  priority: BookingPriority;
  status: BookingStatus;
  reject_reason?: string | null;
  cancel_reason?: string | null;
  manager_comment?: string | null;
  created_at: string;
  updated_at: string;
  ba: BAProfile | null;
  project: Project;
  requester: User;
  manager?: User | null;
};

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  read_at?: string | null;
  created_at: string;
};

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

export function getMockRole(): UserRole {
  return (localStorage.getItem('ba-bazaar-role') as UserRole | null) ?? 'BA_MANAGER';
}

export function setMockRole(role: UserRole) {
  localStorage.setItem('ba-bazaar-role', role);
}

export function getRequestType(booking: Booking): RequestType {
  return booking.ba_id ? 'SPECIFIC_BA' : 'OPEN_REQUEST';
}

export function needsManagerVerification(booking: Booking) {
  const content = `${booking.description}\n${booking.notes ?? ''}`.toLowerCase();

  if (content.includes('[verify]')) {
    return true;
  }

  if (content.includes('need verification') || content.includes('manager verification')) {
    return true;
  }

  return !booking.ba_id && booking.capacity_percent >= 100;
}

export function getManagerRequestState(booking: Booking): ManagerRequestState {
  if (booking.status !== 'PENDING') {
    return booking.status;
  }

  if (!booking.ba_id && needsManagerVerification(booking)) {
    return 'NEED_VERIFICATION';
  }

  if (!booking.ba_id) {
    return 'NEEDS_ASSIGNMENT';
  }

  return 'PENDING';
}

export function getManagerRequestMessage(booking: Booking) {
  const state = getManagerRequestState(booking);

  if (state === 'NEED_VERIFICATION') {
    return 'Needs manager verification';
  }

  if (state === 'NEEDS_ASSIGNMENT') {
    return 'BA not assigned yet';
  }

  if (getRequestType(booking) === 'SPECIFIC_BA' && booking.ba) {
    return `Requested BA: ${booking.ba.full_name}`;
  }

  return 'Ready for manager review';
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-mock-role': getMockRole(),
      ...init?.headers
    }
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `Request failed with ${response.status}`);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function downloadCsv(path: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'x-mock-role': getMockRole()
    }
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? `CSV download failed with ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ba-utilization.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}
