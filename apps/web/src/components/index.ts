// Barrel export for shared components.
// Prefer importing from '@/components' over deep paths so we can refactor
// file layout without touching consumers.

// Layout / page chrome
export { PageHeader } from './PageHeader';
export { StatCard } from './StatCard';

// Toolbar / filters
export { DataToolbar } from './DataToolbar';
export { FilterCard } from './FilterCard';
export { QuickTabs, type QuickTab } from './QuickTabs';
export { TableSearch } from './TableSearch';
export { FilterButton, AdvancedFilterPopover } from './AdvancedFilter';
export { ActiveFilterChips, type ActiveFilter } from './ActiveFilterChips';

// Tables / pagination
export { DataTable } from './DataTable';
export { Pagination } from './Pagination';

// States
export { EmptyState, ErrorState, LoadingScreen } from './States';

// Badges
export { PriorityBadge, StatusBadge, CapacityBadge, FlagBadge } from './Badges';

// Domain components
export { Avatar, BAIdentity, Field } from './common';
export { CreateBAModal } from './CreateBAModal';
