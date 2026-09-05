import {RoomShell} from '@sqlrooms/room-shell';
import {ThemeProvider} from '@sqlrooms/ui';
import {type FC} from 'react';
import {AskAiBadge} from './components/AskAi';
import {roomStore} from './store';

export const App: FC = () => {
  return (
    <ThemeProvider defaultTheme="light" storageKey="apoc-data-theme">
      <RoomShell className="h-screen apoc-room" roomStore={roomStore}>
        {/* No sidebar: the main view is the whole app, and the one thing that
            used to live in a sidebar panel now hovers over it. */}
        <RoomShell.LayoutComposer />
        <RoomShell.LoadingProgress />
        <AskAiBadge />
      </RoomShell>
    </ThemeProvider>
  );
};
