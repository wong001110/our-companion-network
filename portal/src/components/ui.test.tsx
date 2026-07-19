import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ui';

describe('ConfirmDialog', () => {
  it('requires exact typed confirmation and restores focus when closed', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <>
        <button>Launcher</button>
        <ConfirmDialog
          open
          title="Delete account?"
          description="Permanent."
          confirmLabel="Delete"
          destructive
          reason=""
          reasonRequired
          reasonValidator={(value) => value === 'DELETE MY ACCOUNT'}
          reasonError="Type DELETE MY ACCOUNT exactly."
          onReasonChange={() => undefined}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<button>Launcher</button>);
  });

  it('traps tab focus within the modal', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="End visit?"
        description="Reason required."
        confirmLabel="End"
        reason="Operational reason"
        reasonRequired
        onReasonChange={() => undefined}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog');
    for (let index = 0; index < 5; index += 1) await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
});
