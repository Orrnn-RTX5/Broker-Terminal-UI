import { createElement, lazy, type ComponentType } from 'react';

/** Download code ahead of a click without mounting UI or starting its effects. */
export function createPreloadableFeature<Props extends object>(
  loader: () => Promise<{ default: ComponentType<Props> }>,
) {
  let resolved: ComponentType<Props> | undefined;
  let pending: Promise<{ default: ComponentType<Props> }> | undefined;
  const preload = () => {
    if (!pending) {
      pending = loader().then(module => {
        resolved = module.default;
        return module;
      }).catch(error => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
  const LazyComponent = lazy(preload);
  const Component = (props: Props) => createElement(resolved ?? LazyComponent, props);
  return { Component, preload };
}
