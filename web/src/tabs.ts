/**
 * Which page the main view is showing: the dashboard, or one of the files.
 *
 * The active tab lives in a context rather than in `MainView`'s own state so
 * that anything on a page can link to another one -- the dashboard's "download
 * the raw data" sends you to that table's file page -- without threading a
 * callback down through every component.
 *
 * The tab is mirrored in the URL hash, so a single file's page can be linked
 * to directly (`#income`), the way `files.html` used to be.
 */

import {createContext, useContext} from 'react';

/** The tab id of the cross-filtering dashboard. Every other id is a table name. */
export const EXPLORE_TAB = 'explore';

export type TabsState = {
  /** `EXPLORE_TAB`, or the name of the table whose page is showing. */
  activeTab: string;
  setActiveTab: (tab: string) => void;
};

const TabsContext = createContext<TabsState>({
  activeTab: EXPLORE_TAB,
  setActiveTab: () => {},
});

export const TabsProvider = TabsContext.Provider;

export function useTabs(): TabsState {
  return useContext(TabsContext);
}
