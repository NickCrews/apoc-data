/**
 * The main view: the dashboard, plus a page for every published file.
 *
 * SQLRooms' own layout is a mosaic of tiles, which is the right shape for
 * panels you want side by side; these are alternatives to each other, so they
 * get a plain tab strip instead. The tab is kept in the URL hash, so any one
 * file's page can be linked to directly.
 */

import {cn} from '@sqlrooms/ui';
import {FileIcon, LayoutDashboardIcon} from 'lucide-react';
import {useCallback, useEffect, useMemo, useState, type FC} from 'react';
import {TABLES} from '../config';
import {useManifest} from '../manifest';
import {EXPLORE_TAB, TabsProvider} from '../tabs';
import {FreshnessChip, StaleDataBanner} from './DataFreshness';
import {ExploreView} from './ExploreView';
import {FileView} from './FileView';

export const MainView: FC = () => {
  const {manifest} = useManifest();

  // The tables we describe come first, in the order we describe them; anything
  // else the manifest turned up gets a page too.
  const tables = useMemo(() => {
    const extra = (manifest?.tables ?? [])
      .map((t) => t.name)
      .filter((name) => !TABLES.some((t) => t.name === name));
    return [...TABLES.map((t) => t.name), ...extra];
  }, [manifest]);

  const [hash, setHash] = useHash();
  // Derived rather than stored: an unknown hash falls back to the dashboard,
  // but starts working the moment the manifest says that table exists.
  const activeTab = tables.includes(hash) ? hash : EXPLORE_TAB;

  const tabsState = useMemo(
    () => ({activeTab, setActiveTab: setHash}),
    [activeTab, setHash],
  );

  return (
    <TabsProvider value={tabsState}>
      <div className="text-foreground flex h-full flex-col">
        <StaleDataBanner manifest={manifest} />
        {/* The chip sits beside the tab list rather than inside it: the list
            scrolls sideways in a narrow window, and would take the chip with it. */}
        <div className="flex shrink-0 items-center gap-2 border-b pr-2">
          <div
            role="tablist"
            aria-label="Pages"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2"
          >
            <Tab
              label="Explore"
              icon={LayoutDashboardIcon}
              isActive={activeTab === EXPLORE_TAB}
              onClick={() => setHash(EXPLORE_TAB)}
            />
            <div className="bg-border mx-2 h-4 w-px shrink-0" />
            {tables.map((name) => (
              <Tab
                key={name}
                label={TABLES.find((t) => t.name === name)?.label ?? name}
                title={`${name}.parquet / ${name}.csv`}
                icon={FileIcon}
                isActive={activeTab === name}
                onClick={() => setHash(name)}
              />
            ))}
          </div>
          <FreshnessChip manifest={manifest} />
        </div>

        {/* The dashboard stays mounted: rebuilding it means re-running every
            chart's query and losing whatever the reader had filtered to. The
            file pages are cheap, so only the visible one exists. Hidden panes
            keep their size so the charts don't have to be re-laid out. */}
        <div className="relative flex-1">
          <Pane isVisible={activeTab === EXPLORE_TAB}>
            <ExploreView />
          </Pane>
          {activeTab === EXPLORE_TAB ? null : (
            <Pane isVisible key={activeTab}>
              <FileView name={activeTab} />
            </Pane>
          )}
        </div>
      </div>
    </TabsProvider>
  );
};

const Tab: FC<{
  label: string;
  title?: string;
  icon: FC<{className?: string}>;
  isActive: boolean;
  onClick: () => void;
}> = ({label, title, icon: Icon, isActive, onClick}) => (
  <button
    role="tab"
    aria-selected={isActive}
    title={title}
    onClick={onClick}
    className={cn(
      'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
      isActive
        ? 'border-foreground font-medium'
        : 'text-muted-foreground hover:text-foreground border-transparent',
    )}
  >
    <Icon className="h-3.5 w-3.5" />
    {label}
  </button>
);

const Pane: FC<{isVisible: boolean; children: React.ReactNode}> = ({
  isVisible,
  children,
}) => (
  <div
    className={cn(
      'absolute inset-0',
      // `invisible` rather than `hidden`: a display:none pane measures zero
      // wide, and the charts inside build themselves to fit their container.
      !isVisible && 'invisible pointer-events-none',
    )}
    aria-hidden={!isVisible}
  >
    {children}
  </div>
);

/** The URL hash, minus the `#`, kept in sync with the back button. */
function useHash(): [string, (next: string) => void] {
  const [hash, setHash] = useState(() =>
    decodeURIComponent(window.location.hash.slice(1)),
  );
  useEffect(() => {
    const onChange = () =>
      setHash(decodeURIComponent(window.location.hash.slice(1)));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const set = useCallback((next: string) => {
    window.location.hash = next;
    setHash(next);
  }, []);
  return [hash, set];
}
