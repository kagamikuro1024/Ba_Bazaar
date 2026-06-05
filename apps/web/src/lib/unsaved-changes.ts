import { useEffect, useState } from 'react';

export type InboxDirtySummaryItem = {
  id: string;
  label: string;
  approve?: () => Promise<void> | void;
  reject?: () => Promise<void> | void;
};

type InboxDirtyActions = {
  approveAndLeave?: () => Promise<void> | void;
  rejectAndLeave?: () => Promise<void> | void;
};

type InboxDirtyState = InboxDirtyActions & {
  dirty: boolean;
  summary: InboxDirtySummaryItem[];
};

let state: InboxDirtyState = { dirty: false, summary: [] };
const listeners = new Set<() => void>();

export function setInboxDirty(
  dirty: boolean,
  summary: Array<string | InboxDirtySummaryItem> = [],
  actions: InboxDirtyActions = {}
) {
  state = {
    dirty,
    summary: summary.map((item, index) =>
      typeof item === 'string' ? { id: `${index}-${item}`, label: item } : item
    ),
    ...actions
  };
  listeners.forEach((listener) => listener());
}

export function useInboxDirty() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return state;
}
