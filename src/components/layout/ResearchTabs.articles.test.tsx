import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArticlesTab, CodeBaseTab, ExpertsTab } from './ResearchTabs';

describe('ArticlesTab', () => {
  it('renders a clean article table with author and compact ratings', () => {
    const { container } = render(<ArticlesTab />);

    expect(container.querySelector('.rtx-articles-tab')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent).filter(Boolean)).toEqual([
      'Name',
      'Description',
      'Author',
      'Rating',
      'Date',
    ]);
    expect(screen.getByText('Strategies for XAUUSD Scalping')).toBeInTheDocument();
    expect(screen.getByText('GoldMike')).toBeInTheDocument();
    expect(container.querySelectorAll('.rtx-articles-rating')).toHaveLength(4);
    expect(container.querySelectorAll('td.border-r')).toHaveLength(0);
  });

  it('marks a row selected on click', () => {
    const { container } = render(<ArticlesTab />);

    fireEvent.click(screen.getByText('Understanding Order Flow'));
    expect(container.querySelector('.rtx-articles-row[data-selected="true"]')).toHaveTextContent(
      'Understanding Order Flow',
    );
  });
});

describe('CodeBaseTab', () => {
  it('renders a clean code table without icons or vertical rules', () => {
    const { container } = render(<CodeBaseTab />);

    expect(container.querySelector('.rtx-codebase-tab')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent).filter(Boolean)).toEqual([
      'Name',
      'Description',
      'Category',
      'Author',
      'Date',
    ]);
    expect(screen.getByText('RTX5 Trend Master')).toBeInTheDocument();
    expect(screen.getByText('Trend Indicators')).toBeInTheDocument();
    expect(screen.getByText('RTX Systems')).toBeInTheDocument();
    expect(container.querySelectorAll('td.border-r')).toHaveLength(0);
  });

  it('marks a row selected on click', () => {
    const { container } = render(<CodeBaseTab />);

    fireEvent.click(screen.getByText('Institutional Volume'));
    expect(container.querySelector('.rtx-codebase-row[data-selected="true"]')).toHaveTextContent(
      'Institutional Volume',
    );
  });
});

describe('ExpertsTab', () => {
  it('renders a clean experts table with type, compact ratings, and quiet prices', () => {
    const { container } = render(<ExpertsTab />);

    expect(container.querySelector('.rtx-experts-tab')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent).filter(Boolean)).toEqual([
      'Name',
      'Description',
      'Type',
      'Rating',
      'Date',
      'Price',
    ]);
    expect(screen.getByText('RTX Scalper Pro')).toBeInTheDocument();
    expect(screen.getAllByText('Advisor').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.rtx-research-rating')).toHaveLength(5);
    expect(container.querySelector('.rtx-experts-price--paid')).toHaveTextContent('$199');
    expect(container.querySelectorAll('.rtx-experts-price--free').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('td.border-r')).toHaveLength(0);
  });

  it('marks a row selected on click', () => {
    const { container } = render(<ExpertsTab />);

    fireEvent.click(screen.getByText('Golden Zone Indicator'));
    expect(container.querySelector('.rtx-experts-row[data-selected="true"]')).toHaveTextContent(
      'Golden Zone Indicator',
    );
  });
});
