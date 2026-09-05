/**
 * Mounting Mosaic specs into React.
 *
 * `VgPlotChart` from @sqlrooms/mosaic can render a spec directly, but it
 * instantiates the spec's params itself, which would give every chart its own
 * private Selection. Here we parse the spec ourselves and seed the param map
 * with a shared crossfilter Selection, so separate charts filter each other and
 * React can still lay them out however it likes.
 *
 * `Mount` is the other half of not using it. VgPlotChart's effect depends on
 * its whole props object, which is a new one on every render, so it calls
 * `replaceChildren` every time its parent re-renders -- pulling the plot (or
 * the file table, and the header input the reader is typing into) out of the
 * document and putting it back, which drops focus, selection and scroll. This
 * re-attaches only when the element itself is a different element.
 */

import type {Param, Selection, Spec} from '@sqlrooms/mosaic';
import {SpinnerPane} from '@sqlrooms/ui';
import {astToDOM, parseSpec} from '@uwdata/mosaic-spec';
import {useEffect, useLayoutEffect, useRef, useState, type FC} from 'react';

export type PlotParams = Map<string, Param<unknown> | Selection>;

/**
 * astToDOM's own option type says the map holds Params, but mosaic itself puts
 * Selections in it -- which is the whole reason we can seed one here.
 */
type AstParams = NonNullable<NonNullable<Parameters<typeof astToDOM>[1]>['params']>;

type PlotElement = HTMLElement | SVGSVGElement;

export function useVgPlot(
  spec: Spec | undefined,
  params: PlotParams,
  ready: boolean,
): {element: PlotElement | undefined; error: Error | undefined} {
  const [element, setElement] = useState<PlotElement>();
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (!spec || !ready) return;
    let cancelled = false;
    (async () => {
      try {
        const ast = await parseSpec(spec);
        // astToDOM only instantiates params the map doesn't already have, so
        // the shared Selection wins over the spec's own declaration.
        const dom = await astToDOM(ast, {params: params as AstParams});
        if (!cancelled) {
          setElement(dom.element);
          setError(undefined);
        }
      } catch (e) {
        if (!cancelled) setError(e as Error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spec, params, ready]);

  return {element, error};
}

export type PlotProps = {
  spec: Spec | undefined;
  params: PlotParams;
  ready: boolean;
  className?: string;
};

/** A Mosaic spec, rendered once it (and duckdb) are ready. */
export const Plot: FC<PlotProps> = ({spec, params, ready, className}) => {
  const {element, error} = useVgPlot(spec, params, ready);
  if (error) {
    return (
      <div className="text-destructive p-3 font-mono text-xs whitespace-pre-wrap">
        {error.message}
      </div>
    );
  }
  if (!element) {
    return <SpinnerPane className="h-40 w-full" />;
  }
  // Plot inherits currentColor for its axis text, so the text-foreground here
  // is what keeps the chrome readable in both light and dark themes.
  return <Mount element={element} className={className} />;
};

/**
 * Put an element React didn't make into the tree, and then leave it alone.
 *
 * Moving a node is not the same as leaving it where it is: re-inserting the
 * subtree a text cursor is in blurs it. So the element goes in when it arrives
 * and comes out when it is replaced, and a parent's re-render does neither.
 */
export const Mount: FC<{
  element: Element | undefined;
  className?: string;
}> = ({element, className}) => {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node || !element) return;
    node.replaceChildren(element);
    return () => {
      if (node.firstChild === element) node.replaceChildren();
    };
  }, [element]);
  return <div ref={host} className={className} />;
};

/** The width of an element, so specs can be built to fit their container. */
export function useElementWidth<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  number,
] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      // Rebuilding a spec tears down and recreates its Mosaic clients, which
      // resets any active brush, so only react to real size changes.
      setWidth((prev) => (Math.abs(prev - next) < 40 ? prev : Math.round(next)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** The height of an element, for the tables that are told how tall to be. */
export function useElementHeight<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  number,
] {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.height ?? 0;
      // Same reason as the width: a rebuilt table is a new Mosaic client, and
      // the reader's scroll position and sort go with the old one.
      setHeight((prev) =>
        Math.abs(prev - next) < 40 ? prev : Math.round(next),
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, height];
}
