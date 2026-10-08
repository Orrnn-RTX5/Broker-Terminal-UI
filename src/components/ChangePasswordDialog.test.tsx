import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangePasswordDialog } from './ChangePasswordDialog';

const mocks = vi.hoisted(() => ({ changePassword: vi.fn(), setInvestorPassword: vi.fn() }));
vi.mock('../api/trade', () => ({
    tradeApi: {
        auth: { changePassword: mocks.changePassword },
        account: { setInvestorPassword: mocks.setInvestorPassword },
    },
}));

describe('ChangePasswordDialog keyboard access', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(cleanup);

    it('focuses the current password, wraps Tab, closes on Escape, and restores the trigger without submitting', () => {
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();
        const onClose = vi.fn();
        const view = render(<ChangePasswordDialog isOpen accountLogin="200003" onClose={onClose} />);
        const dialog = screen.getByRole('dialog', { name: 'Change Password - 200003' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByLabelText('Current Password')).toHaveFocus();
        const close = screen.getByRole('button', { name: 'Close' });
        const submit = screen.getByRole('button', { name: 'Change Password' });
        close.focus();
        fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
        expect(submit).toHaveFocus();
        fireEvent.keyDown(submit, { key: 'Tab' });
        expect(close).toHaveFocus();
        fireEvent.keyDown(close, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
        expect(mocks.changePassword).not.toHaveBeenCalled();
        expect(mocks.setInvestorPassword).not.toHaveBeenCalled();
        view.rerender(<ChangePasswordDialog isOpen={false} accountLogin="200003" onClose={onClose} />);
        expect(trigger).toHaveFocus();
        trigger.remove();
    });

    it('leaves a newer local dialog in control of Escape and Tab', () => {
        const onClose = vi.fn();
        render(<ChangePasswordDialog isOpen accountLogin="200003" onClose={onClose} />);
        const newerDialog = document.createElement('div');
        newerDialog.setAttribute('role', 'dialog');
        const button = document.createElement('button');
        newerDialog.append(button);
        document.body.append(newerDialog);
        button.focus();
        try {
            fireEvent.keyDown(button, { key: 'Escape' });
            fireEvent.keyDown(button, { key: 'Tab', shiftKey: true });
            expect(button).toHaveFocus();
            expect(onClose).not.toHaveBeenCalled();
            expect(mocks.changePassword).not.toHaveBeenCalled();
            expect(mocks.setInvestorPassword).not.toHaveBeenCalled();
        } finally {
            newerDialog.remove();
        }
    });
});
