/** A link to a screen: a real URL (new tab, copy link work), navigated in place on a plain click. */
import type { ComponentChildren, JSX } from "preact";
import { type Route, routeToHash } from "../../app/router";
import { go } from "../../app/state";

export function Link(props: {
  to: Route;
  class?: string;
  children: ComponentChildren;
  current?: boolean;
  testId?: string;
}): JSX.Element {
  return (
    <a
      href={routeToHash(props.to)}
      class={props.class}
      data-testid={props.testId}
      aria-current={props.current ? "page" : undefined}
      onClick={(e) => {
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        )
          return;
        e.preventDefault();
        go(props.to);
      }}
    >
      {props.children}
    </a>
  );
}
