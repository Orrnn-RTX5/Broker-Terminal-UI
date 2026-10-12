import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigatorPanel } from './NavigatorPanel';
import type { SavedAccount } from '../../store/useAppStore';

const mocks = vi.hoisted(() => ({
    accountId: '200003',
    isAuthenticated: true,
    savedAccounts: [] as SavedAccount[],
    addSavedAccount: vi.fn(),
    removeSavedAccount: vi.fn(),
    logout: vi.fn(),
    openWebTrader: vi.fn(),
}));

vi.mock('../../store/useAppStore', () => ({
    useAppStore: (selector: (state: typeof mocks) => unknown) => selector(mocks),
}));
vi.mock('../../api/trade', () => ({
    brokerV2Api: { getServers: vi.fn().mockResolvedValue([]), getBrokers: vi.fn().mockResolvedValue({ brokers: [] }) },
}));
vi.mock('../../services/api', () => ({ api: { auth: { logout: mocks.logout } } }));
vi.mock('../../services/webTrader', () => ({ openWebTrader: mocks.openWebTrader }));
vi.mock('../../services/brokerServers', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../services/brokerServers')>(),
    getStoredBrokerServer: () => 'Orrnn',
}));
vi.mock('../../startup/runAfterTerminalReady', () => ({ runAfterTerminalReady: () => () => undefined }));
vi.mock('../../startup/terminalFeatures', () => ({
    openAccountFeature: {
        Component: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div role="dialog" aria-label="Open an Account" /> : null,
    },
}));
vi.mock('../LoginDialog', () => ({
    LoginDialog: ({ isOpen, initialLogin, initialServer }: { isOpen: boolean; initialLogin: string; initialServer: string }) => (
        isOpen ? <div role="dialog" aria-label="Account login">{initialLogin} {initialServer}</div> : null
    ),
}));
vi.mock('../ChangePasswordDialog', () => ({
    ChangePasswordDialog: ({ isOpen, accountLogin }: { isOpen: boolean; accountLogin: string }) => (
        isOpen ? <div role="dialog" aria-label="Change Password">{accountLogin}</div> : null
    ),
}));

const rightClickAccount = (label = '200003: demo acc1') => {
    fireEvent.contextMenu(screen.getByText(label), { clientX: 120, clientY: 240 });
    return screen.getByRole('menu');
};

describe('Navigator account context menu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.accountId = '200003';
        mocks.isAuthenticated = true;
        mocks.savedAccounts = [{ login: 200003, name: 'demo acc1', server: 'Orrnn', isLive: false }];
        mocks.openWebTrader.mockResolvedValue({ status: 'opened', brokerName: 'Orrnn' });
    });

    it('opens one account menu from the name/number row, with the reference action order', () => {
        render(<NavigatorPanel />);
        const menu = rightClickAccount();
        expect(screen.getAllByRole('menu')).toHaveLength(1);
        expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual([
            'Open an AccountInsert', 'Login to Trade AccountEnter', 'Login to Web Trader',
            'Login to RTX5.community', 'Change Password', 'DeleteDelete', 'Deposit',
            'Withdrawal', 'Add to Favorites',
        ]);
        expect(within(menu).getAllByRole('separator')).toHaveLength(4);
        for (const name of ['Deposit', 'Withdrawal', 'Login to RTX5.community']) {
            expect(within(menu).getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true');
        }
    });

    it('opens the registration dialog from both account and Accounts menus', () => {
        const { unmount } = render(<NavigatorPanel />);
        fireEvent.click(within(rightClickAccount()).getByRole('menuitem', { name: 'Open an AccountInsert' }));
        expect(screen.getByRole('dialog', { name: 'Open an Account' })).toBeInTheDocument();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        unmount();
        render(<NavigatorPanel />);
        fireEvent.contextMenu(screen.getByText('Accounts'));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Open an AccountInsert' }));
        expect(screen.getByRole('dialog', { name: 'Open an Account' })).toBeInTheDocument();
    });

    it('opens login prefilled for the account that was right-clicked', async () => {
        render(<NavigatorPanel />);
        fireEvent.click(within(rightClickAccount()).getByRole('menuitem', { name: 'Login to Trade AccountEnter' }));
        expect(await screen.findByRole('dialog', { name: 'Account login' })).toHaveTextContent('200003 Orrnn');
    });

    it('opens password changes for the active account and disables them on saved inactive accounts', () => {
        mocks.savedAccounts.push({ login: 200004, name: 'other', server: 'Orrnn', isLive: false });
        render(<NavigatorPanel />);
        const otherMenu = rightClickAccount('200004: other');
        expect(within(otherMenu).getByRole('menuitem', { name: 'Change Password' })).toHaveAttribute('aria-disabled', 'true');
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.click(within(rightClickAccount()).getByRole('menuitem', { name: 'Change Password' }));
        expect(screen.getByRole('dialog', { name: 'Change Password' })).toHaveTextContent('200003');
    });

    it('uses the existing broker Web Trader flow', async () => {
        render(<NavigatorPanel />);
        fireEvent.click(within(rightClickAccount()).getByRole('menuitem', { name: 'Login to Web Trader' }));
        await waitFor(() => expect(mocks.openWebTrader).toHaveBeenCalledOnce());
    });

    it('saves Favorites on the selected account and lets them be removed', () => {
        const { rerender } = render(<NavigatorPanel />);
        fireEvent.click(within(rightClickAccount()).getByRole('menuitem', { name: 'Add to Favorites' }));
        expect(mocks.addSavedAccount).toHaveBeenLastCalledWith({ ...mocks.savedAccounts[0], isFavorite: true });
        mocks.savedAccounts = [{ ...mocks.savedAccounts[0], isFavorite: true }];
        rerender(<NavigatorPanel />);
        const favorites = screen.getByRole('region', { name: 'Favorites' });
        expect(within(favorites).getByLabelText('Favorite account')).toBeInTheDocument();
        expect(within(favorites).getByText('200003: demo acc1 · Orrnn')).toBeInTheDocument();
        fireEvent.click(within(rightClickAccount()).getByRole('menuitem', { name: 'Remove from Favorites' }));
        expect(mocks.addSavedAccount).toHaveBeenLastCalledWith({ ...mocks.savedAccounts[0], isFavorite: false });
        mocks.savedAccounts = [{ ...mocks.savedAccounts[0], isFavorite: false }];
        rerender(<NavigatorPanel />);
        expect(within(favorites).queryByText('200003: demo acc1 · Orrnn')).not.toBeInTheDocument();
        expect(within(favorites).getByText('No favorite accounts yet')).toBeInTheDocument();
    });

    it('shows saved favorites after logout and opens a prefilled interactive login', async () => {
        mocks.isAuthenticated = false;
        mocks.savedAccounts = [{ ...mocks.savedAccounts[0], isFavorite: true }];
        render(<NavigatorPanel />);
        const favorites = screen.getByRole('region', { name: 'Favorites' });
        fireEvent.click(within(favorites).getByText('200003: demo acc1 · Orrnn'));
        expect(await screen.findByRole('dialog', { name: 'Account login' })).toHaveTextContent('200003 Orrnn');
        expect(mocks.logout).not.toHaveBeenCalled();
    });

    it('removes a favorite through its own context menu', () => {
        mocks.savedAccounts = [{ ...mocks.savedAccounts[0], isFavorite: true }];
        render(<NavigatorPanel />);
        fireEvent.contextMenu(within(screen.getByRole('region', { name: 'Favorites' })).getByText('200003: demo acc1 · Orrnn'));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Favorites' }));
        expect(mocks.addSavedAccount).toHaveBeenCalledWith({ ...mocks.savedAccounts[0], isFavorite: false });
    });

    it('closes on Escape, outside click and account session changes', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<NavigatorPanel />);
        rightClickAccount();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        rightClickAccount();
        await user.click(document.body);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        rightClickAccount();
        mocks.accountId = '200004';
        rerender(<NavigatorPanel />);
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('only removes the saved account after delete confirmation', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<NavigatorPanel />);
        fireEvent.click(within(rightClickAccount()).getByRole('menuitem', { name: 'DeleteDelete' }));
        expect(mocks.removeSavedAccount).not.toHaveBeenCalled();
        expect(mocks.logout).not.toHaveBeenCalled();
        confirm.mockReturnValue(true);
        fireEvent.click(within(rightClickAccount()).getByRole('menuitem', { name: 'DeleteDelete' }));
        expect(mocks.removeSavedAccount).toHaveBeenCalledWith(200003, 'Orrnn');
        expect(mocks.logout).toHaveBeenCalledOnce();
        confirm.mockRestore();
    });
});
