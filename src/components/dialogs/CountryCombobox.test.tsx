// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CountryCombobox } from './CountryCombobox';
import { COUNTRIES, ISO_COUNTRY_CODES, resolveCountryCode } from '../../constants/countries';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ControlledCountry = ({ initial = 'US', onChange = (_code: string) => {} }) => {
  const [value, setValue] = useState(initial);
  return <>
    <CountryCombobox value={value} onChange={code => { setValue(code); onChange(code); }} />
    <output aria-label="Selected country code">{value}</output>
  </>;
};

describe('CountryCombobox', () => {
  it('provides all 249 assigned countries and territories without reserved regions', () => {
    expect(ISO_COUNTRY_CODES).toHaveLength(249);
    expect(new Set(ISO_COUNTRY_CODES).size).toBe(249);
    expect(ISO_COUNTRY_CODES.every(code => /^[A-Z]{2}$/.test(code))).toBe(true);
    for (const code of ['AX', 'AQ', 'BQ', 'BV', 'CC', 'CW', 'GF', 'GP', 'GU', 'HK', 'MO', 'PS', 'RE', 'SS', 'SX', 'TW', 'UM']) {
      expect(ISO_COUNTRY_CODES).toContain(code);
      expect(COUNTRIES.find(country => country.code === code)?.name).not.toBe(code);
    }
    for (const code of ['AC', 'CP', 'CQ', 'DG', 'EA', 'EU', 'IC', 'TA', 'UK', 'XK', 'ZZ']) {
      expect(ISO_COUNTRY_CODES).not.toContain(code);
      expect(resolveCountryCode(code)).toBe('');
    }

    render(<ControlledCountry />);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Country' }));
    expect(screen.getByRole('listbox', { name: 'Country' }).querySelectorAll('[role="option"]')).toHaveLength(249);
  });

  it('accepts exact names and case-insensitive codes but preserves invalid editable text', () => {
    const onChange = vi.fn();
    render(<ControlledCountry onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Country' });
    fireEvent.focus(input);

    fireEvent.change(input, { target: { value: 'india' } });
    expect(onChange).toHaveBeenLastCalledWith('IN');
    expect(screen.getByLabelText('Selected country code')).toHaveTextContent('IN');
    fireEvent.blur(input);
    expect(input).toHaveValue('India');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ca' } });
    expect(onChange).toHaveBeenLastCalledWith('CA');
    fireEvent.change(input, { target: { value: 'Canad' } });
    expect(input).toHaveValue('Canad');
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByLabelText('Selected country code')).toBeEmptyDOMElement();
    fireEvent.blur(input);
    expect(input).toHaveValue('Canad');
  });

  it('matches country names without requiring accents or typographic apostrophes', () => {
    expect(resolveCountryCode('Aland Islands')).toBe('AX');
    expect(resolveCountryCode("Cote d'Ivoire")).toBe('CI');
    expect(resolveCountryCode('  united kingdom  ')).toBe('GB');
    expect(resolveCountryCode('United')).toBe('');
  });

  it('filters countries and selects a keyboard-highlighted result with Enter', () => {
    render(<ControlledCountry />);
    const input = screen.getByRole('combobox', { name: 'Country' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'united' } });
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'country-combobox-option-GB');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue('United Kingdom');
    expect(screen.getByLabelText('Selected country code')).toHaveTextContent('GB');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('selects a country by clicking its option', () => {
    render(<ControlledCountry />);
    const input = screen.getByRole('combobox', { name: 'Country' });
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole('option', { name: 'India' }));
    expect(input).toHaveValue('India');
    expect(screen.getByLabelText('Selected country code')).toHaveTextContent('IN');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes with Escape or blur and does not accept an unmatched query', () => {
    const onChange = vi.fn();
    render(<ControlledCountry onChange={onChange} />);
    const input = screen.getByRole('combobox', { name: 'Country' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Not a real country' } });
    expect(screen.getByText('No countries found')).toHaveAttribute('role', 'status');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(input).toHaveValue('Not a real country');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Selected country code')).toBeEmptyDOMElement();
  });

  it('renders the popup above a low input outside the modal clipping container', () => {
    const view = render(<div style={{ overflow: 'hidden' }}><ControlledCountry /></div>);
    const input = screen.getByRole('combobox', { name: 'Country' });
    const top = window.innerHeight - 60;
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
      x: 40, y: top, top, left: 40, bottom: top + 38, right: 440, width: 400, height: 38,
      toJSON: () => ({}),
    });
    fireEvent.focus(input);
    const popup = screen.getByRole('listbox', { name: 'Country' });
    expect(view.container.contains(popup)).toBe(false);
    expect(popup).toHaveStyle({ bottom: '64px', maxHeight: '220px', width: '400px', left: '40px' });
  });

  it('reflects externally changed values and exposes the validation error accessibly', () => {
    const onChange = vi.fn();
    const view = render(<CountryCombobox value="US" onChange={onChange} />);
    view.rerender(<CountryCombobox value="IN" onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveValue('India');
    view.rerender(<CountryCombobox value="" onChange={onChange} error="Select a country from the list." />);
    const input = screen.getByRole('combobox', { name: 'Country' });
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Select a country from the list.');
    expect(onChange).not.toHaveBeenCalled();
  });
});
