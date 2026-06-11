import { clearStoredSession, getStoredRole, getStoredSession, setStoredSession } from '@/auth/storage';

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
export type CapacityClassification =
  | 'BENCH'
  | 'LOW'
  | 'AVAILABLE'
  | 'HIGH'
  | 'FULL'
  | 'OVERBOOKED';
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
  skill_tags: Array<{ id: string; tag: SkillTag } | SkillTag>;
  bookings?: Booking[];
  approved_capacity?: number;
  pending_capacity?: number;
  risk_capacity?: number;
  booked_man_days?: number;
  available_man_days?: number;
  utilization_percent?: number;
  capacity_label?: CapacityClassification;
  current_projects?: Array<{
    project_id: string;
    project_name: string;
    color: string;
    capacity_percent: number;
    man_days?: number;
  }>;
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
  pending_changes?: Record<string, unknown> | null;
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

export type ManagerDashboardSummary = {
  timeframe: {
    from: string;
    to: string;
  };
  team: {
    total_ba: number;
    team_utilization_percent: number;
    bench_count: number;
    bench_rate_percent: number;
    overbooked_count: number;
    total_man_days: number;
    total_available_man_days: number;
  };
  actions: {
    pending_requests: number;
    unassigned_requests: number;
    urgent_requests: number;
    overbooked_ba: number;
    bench_ba: number;
  };
  capacity_distribution: {
    bench: number;
    low: number;
    available: number;
    high: number;
    full: number;
    overbooked: number;
  };
  ba_utilization: Array<{
    ba_id: string;
    ba_name: string;
    level: BALevel;
    booked_man_days: number;
    available_man_days: number;
    utilization_percent: number;
    approved_capacity: number;
    pending_capacity: number;
    risk_capacity: number;
    capacity_label: CapacityClassification;
    current_projects: Array<{
      project_id: string;
      project_name: string;
      color: string;
      capacity_percent: number;
      man_days: number;
    }>;
  }>;
  project_effort: Array<{
    project_id: string;
    project_name: string;
    color: string;
    man_days: number;
    allocation_percent: number;
    booking_count: number;
    ba_count: number;
  }>;
};

function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
  if (configured) {
    return configured;
  }

  if (typeof window !== 'undefined') {
    if (import.meta.env.MODE === 'production') {
      return window.location.origin;
    }

    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${window.location.hostname}:3000`;
  }

  return 'http://localhost:3000';
}

export const API_BASE_URL = resolveApiBaseUrl();

let refreshPromise: Promise<string | null> | null = null;

export function getMockRole(): UserRole {
  return getStoredRole() ?? 'BA_MANAGER';
}

export function setMockRole() {
  return;
}

function allowMockAuth() {
  return import.meta.env.MODE !== 'production' && import.meta.env.VITE_ALLOW_MOCK_AUTH === 'true';
}

async function refreshAccessToken() {
  const session = getStoredSession();
  if (!session?.refreshToken) {
    return null;
  }

  const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ refresh_token: session.refreshToken })
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        message?: string;
        access_token?: string;
        refresh_token?: string;
      }
    | null;

  if (!response.ok || !payload?.access_token || !payload.refresh_token) {
    clearStoredSession();
    window.dispatchEvent(new Event('auth:logout'));
    return null;
  }

  const nextSession = {
    ...session,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token
  };
  setStoredSession(nextSession);
  window.dispatchEvent(new Event('auth:refresh'));
  return nextSession.accessToken;
}

async function getFreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

function buildHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const session = getStoredSession();

  if (!headers.has('Content-Type') && init?.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (session?.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  } else if (allowMockAuth()) {
    headers.set('x-mock-role', getMockRole());
  }

  return headers;
}

async function parseError(response: Response) {
  const error = (await response.json().catch(() => null)) as { message?: string } | null;
  return error?.message ?? `Request failed with ${response.status}`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeSkillTagEntry(entry: unknown): unknown {
  if (!isRecord(entry)) {
    return entry;
  }

  if ('tag' in entry && entry.tag) {
    return entry;
  }

  if ('name' in entry && 'group' in entry) {
    return {
      id: entry.id,
      tag: {
        id: entry.id,
        name: entry.name,
        group: entry.group,
        status: entry.status
      }
    };
  }

  return entry;
}

function normalizeBAProfile(ba: unknown): unknown {
  if (!isRecord(ba)) {
    return ba;
  }

  const normalized = { ...ba };
  if (Array.isArray(normalized.skill_tags)) {
    normalized.skill_tags = normalized.skill_tags.map(normalizeSkillTagEntry);
  }
  return normalized;
}

function normalizeBooking(booking: unknown): unknown {
  if (!isRecord(booking)) {
    return booking;
  }

  const normalized = { ...booking };
  if (isRecord(normalized.ba)) {
    normalized.ba = normalizeBAProfile(normalized.ba);
  }
  if (normalized.project == null && normalized.project_name) {
    normalized.project = {
      id: normalized.project_id,
      name: normalized.project_name,
      color: normalized.color ?? '#2563EB',
      description: normalized.description ?? null
    };
  }
  return normalized;
}

function normalizeApiData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeApiData);
  }

  if (!isRecord(value)) {
    return value;
  }

  if ('skill_tags' in value || 'current_projects' in value) {
    return normalizeBAProfile(value);
  }

  if ('project_id' in value && 'requester_id' in value && 'status' in value) {
    return normalizeBooking(value);
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    normalized[key] = normalizeApiData(nested);
  }
  return normalized;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Capture the body up-front so we can replay it on a 401-retry.
  // Without this, a JSON.stringify'd body becomes a consumed stream
  // after the first fetch and the retry sends an empty body, which
  // the server rejects as 400/422 — leaving the user stuck.
  const replayBody = captureReplayBody(init?.body);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    body: replayBody.value,
    headers: buildHeaders(init)
  });

  if (response.status === 401 && !path.startsWith('/api/auth/') && replayBody.text != null) {
    const nextAccessToken = await getFreshAccessToken();
    if (nextAccessToken) {
      const retryHeaders = buildHeaders(init);
      retryHeaders.set('Authorization', `Bearer ${nextAccessToken}`);

      const retryResponse = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        body: replayBody.text,
        headers: retryHeaders
      });

      if (!retryResponse.ok) {
        throw new Error(await parseError(retryResponse));
      }

      const retryText = await retryResponse.text();
      return normalizeApiData(retryText ? JSON.parse(retryText) : null) as T;
    }
  }

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const text = await response.text();
  return normalizeApiData(text ? JSON.parse(text) : null) as T;
}

// captureReplayBody snapshots a fetch body so it can be sent twice
// (once on the original request, once on a 401 retry). For JSON
// bodies we keep the original text; for FormData/Blob we pass through
// only on the first call (the second will need a different strategy,
// but our app only retries JSON requests in practice).
function captureReplayBody(body: RequestInit['body']): {
  value: RequestInit['body'];
  text: string | null;
} {
  if (body == null) return { value: body, text: null };
  if (typeof body === 'string') return { value: body, text: body };
  if (body instanceof URLSearchParams) {
    const text = body.toString();
    return { value: text, text };
  }
  // FormData / Blob / ReadableStream: don't try to replay.
  return { value: body, text: null };
}

export async function downloadCsv(path: string) {
  let response = await fetch(`${API_BASE_URL}${path}`, {
    headers: buildHeaders()
  });

  if (response.status === 401) {
    const nextAccessToken = await getFreshAccessToken();
    if (nextAccessToken) {
      response = await fetch(`${API_BASE_URL}${path}`, {
        headers: buildHeaders()
      });
    }
  }

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ba-utilization.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}
