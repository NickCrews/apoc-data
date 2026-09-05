/**
 * Which way the theme currently reads, for the charts.
 *
 * Mosaic marks take plain color strings rather than CSS variables, so anything
 * that draws has to know whether it's painting onto a light or a dark surface.
 */

import {useTheme} from '@sqlrooms/ui';
import {useEffect, useState} from 'react';

export function useIsDark(): boolean {
  const {theme} = useTheme();
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return theme === 'dark' || (theme === 'system' && systemDark);
}
