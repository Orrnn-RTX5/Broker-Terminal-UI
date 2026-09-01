// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DockPanel } from './DockPanel';

describe('Navigator dock chrome', () => {
  it('keeps one outer title and a working close control', () => {
    const onClose = vi.fn();

    const { container } = render(
      <DockPanel
        panel={{
          id: 'navigator',
          title: 'Navigator',
          component: 'Navigator',
          closable: true,
          ratio: 0.5,
        }}
        onClose={onClose}
      >
        <div className="navigator-panel">
          <div className="navigator-panel__body">Accounts</div>
        </div>
      </DockPanel>,
    );

    expect(screen.getAllByText('Navigator')).toHaveLength(1);
    expect(screen.getByText('Navigator')).toHaveClass('dock-panel__title');
    expect(container.querySelector('.navigator-panel__header')).toBeNull();
    expect(container.querySelector('.navigator-panel__body')).not.toBeNull();

    fireEvent.click(screen.getByTitle('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
