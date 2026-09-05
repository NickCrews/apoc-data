import {createMosaicSlice} from '@sqlrooms/mosaic';
import type {MosaicSliceState} from '@sqlrooms/mosaic/dist/MosaicSlice';
import {
  createRoomShellSlice,
  createRoomStore,
  MAIN_VIEW,
  type LayoutConfig,
  type RoomShellSliceState,
} from '@sqlrooms/room-shell';
// Deep import on purpose: the package barrel pulls in Monaco, and we want
// the editor to stay in its own lazily loaded chunk (see App.tsx).
import {
  createSqlEditorSlice,
  type SqlEditorSliceState,
} from '@sqlrooms/sql-editor/dist/SqlEditorSlice';
import {MainView} from './components/MainView';
import {dataUrl, TABLES} from './config';
import {installCoordinator} from './coordinator';

// Before the mosaic slice below asks for one: whoever calls `coordinator()`
// first decides which coordinator the whole app gets.
installCoordinator();

const STARTER_QUERY = `-- Who gave the most to candidates and groups in 2024?
SELECT
  last_business_name AS donor,
  count(*) AS contributions,
  sum(amount) AS total
FROM income
WHERE report_year = 2024
GROUP BY donor
ORDER BY total DESC
LIMIT 25;`;

export const PanelTypes = {
  main: MAIN_VIEW,
} as const;

export type RoomState = RoomShellSliceState &
  MosaicSliceState &
  SqlEditorSliceState;

export const {roomStore, useRoomStore} = createRoomStore<RoomState>(
  (set, get, store) => ({
    ...createRoomShellSlice({
      config: {
        title: 'Alaska Campaign Finance Explorer',
        /**
         * Every table is downloaded as parquet and materialized into duckdb-wasm
         * up front. The whole dataset is ~28MB compressed, and the dashboard
         * cross-filters over a million rows of it — pulling it in once keeps
         * every interaction after that instant and offline.
         */
        dataSources: TABLES.map(({name}) => ({
          type: 'url' as const,
          tableName: name,
          url: dataUrl(`${name}.parquet`),
          loadOptions: {method: 'read_parquet' as const},
        })),
      },
      layout: {
        config: {
          type: 'mosaic',
          nodes: MAIN_VIEW,
        } satisfies LayoutConfig,
        panels: {
          [PanelTypes.main]: {
            /**
             * The dashboard and a page for every published file, behind one tab
             * strip. See MainView.
             */
            title: 'Explore',
            component: MainView,
            placement: 'main',
          },
        },
      },
    })(set, get, store),

    ...createMosaicSlice()(set, get, store),

    // Open the editor on a query that already does something, so the first
    // thing a curious visitor sees is an answer rather than a blank tab.
    ...createSqlEditorSlice({
      config: {
        queries: [{id: 'starter', name: 'Top donors', query: STARTER_QUERY}],
        selectedQueryId: 'starter',
        openTabs: ['starter'],
      },
    })(set, get, store),
  }),
);
