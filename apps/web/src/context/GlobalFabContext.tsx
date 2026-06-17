import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';

export interface FabAction {
  label: string;
  icon: ReactNode;
  onPress: () => void;
}

interface GlobalFabContextValue {
  primaryAction: FabAction | null;
  setPrimaryAction: (action: FabAction | null) => void;
  visible: boolean;
  setVisible: (visible: boolean) => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
}

const GlobalFabContext = createContext<GlobalFabContextValue | null>(null);

export function GlobalFabProvider({ children }: { children: ReactNode }) {
  const [primaryAction, setPrimaryAction] = useState<FabAction | null>(null);
  const [visible, setVisible] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

  const value = useMemo(
    () => ({
      primaryAction,
      setPrimaryAction,
      visible,
      setVisible,
      chatOpen,
      setChatOpen
    }),
    [primaryAction, visible, chatOpen]
  );

  return (
    <GlobalFabContext.Provider value={value}>
      {children}
    </GlobalFabContext.Provider>
  );
}

export function useGlobalFab() {
  const context = useContext(GlobalFabContext);
  if (!context) {
    throw new Error('useGlobalFab must be used within a GlobalFabProvider');
  }
  return context;
}

/**
 * Hook for pages to declare their primary floating action.
 * Auto-cleans up when the component unmounts.
 */
export function useFabAction(action: FabAction | null, deps: any[] = []) {
  const { setPrimaryAction } = useGlobalFab();

  const memoizedAction = useMemo(() => action, deps);

  useEffect(() => {
    setPrimaryAction(memoizedAction);
    return () => {
      setPrimaryAction(null);
    };
  }, [memoizedAction, setPrimaryAction]);
}
