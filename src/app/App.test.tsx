import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialUi, useStore } from '../state/store';
import { MockTransport } from '../transport/MockTransport';
import type { ScenarioName } from '../transport/scenarios';
import { App } from './App';

function renderScenario(name: ScenarioName) {
  const make = () => new MockTransport(name);
  return render(<App createTransport={make} scenario={name} />);
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

const stopButton = () =>
  screen.getByRole('button', { name: /^(STOP|Đang dừng…|Đã dừng|Chưa xác nhận dừng)$/ });

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    useStore.getState().reset();
    useStore.setState({ ...initialUi(), lang: 'vi' });
  });
  afterEach(() => vi.useRealTimers());

  it('STOP is the first control and works by keyboard on both tabs; "Đã dừng" only after ACK', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('stop-ok');
    await advance(1500);

    await user.tab(); // skip link
    await user.tab();
    expect(stopButton()).toHaveFocus();

    await user.click(screen.getByRole('tab', { name: 'Tutorial' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Hướng dẫn sử dụng' }),
    ).toBeInTheDocument();

    stopButton().focus();
    await user.keyboard('{Enter}');
    expect(stopButton()).toHaveTextContent('Đang dừng…');
    await advance(400);
    expect(stopButton()).toHaveTextContent('Đã dừng');

    await user.click(screen.getByRole('tab', { name: 'Monitoring' }));
    expect(screen.getByTestId('lamp')).toHaveTextContent('Chờ người dùng');
    expect(screen.getByTestId('run-chip')).toHaveTextContent('Đã dừng · chờ Sẵn sàng hoặc lệnh mới');
    // The stopped run is over (ABORTED + HOLD): no Ready, a new command starts a new episode.
    expect(screen.queryByRole('button', { name: 'Sẵn sàng' })).not.toBeInTheDocument();
    expect(screen.getByTestId('cmd-reason')).toHaveTextContent('Chọn profile AI trước khi gửi.');
    await user.selectOptions(screen.getByLabelText('Profile AI'), 'smolvla-int8');
    await user.click(screen.getByRole('button', { name: 'Gửi lệnh' }));
    await advance(1000);
    expect(screen.getByTestId('lamp')).toHaveTextContent('Hệ thống ổn');
    expect(stopButton()).toHaveTextContent('STOP');
    expect(screen.getByTestId('run-chip')).toHaveTextContent('Đang chạy');
  });

  it('without a stop ACK it says to use the physical emergency stop', async () => {
    renderScenario('stop-no-ack');
    await advance(1500);
    await act(async () => stopButton().click());
    await advance(4600);
    expect(stopButton()).toHaveTextContent('Chưa xác nhận dừng');
    expect(screen.getByText('Dùng nút dừng khẩn cấp vật lý trên robot.')).toBeInTheDocument();
    const banner = screen.getByRole('alert');
    expect(within(banner).getByText(/Chưa xác nhận lệnh dừng sau 4 s/)).toBeInTheDocument();
  });

  it('shows the exact command, the NACK reason, and never a success state', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('cmd-nack');
    await advance(1500);
    expect(screen.getByTestId('cmd-reason')).toHaveTextContent('Chọn profile AI trước khi gửi.');
    await user.selectOptions(screen.getByLabelText('Profile AI'), 'smolvla-int8');
    expect(screen.getByTestId('cmd-preview')).toHaveTextContent('libero_object #0');
    await user.click(screen.getByRole('button', { name: 'Gửi lệnh' }));
    expect(screen.getByTestId('cmd-lifecycle')).toHaveAttribute('data-phase', 'sent');
    await advance(300);
    const lifecycle = screen.getByTestId('cmd-lifecycle');
    expect(lifecycle).toHaveAttribute('data-phase', 'rejected');
    expect(lifecycle).not.toHaveTextContent('Xong');
    expect(lifecycle).toHaveTextContent('task_id không có trong suite');
  });

  it('Send stays disabled with a written reason while a task runs', async () => {
    renderScenario('running');
    await advance(1500);
    const send = screen.getByRole('button', { name: 'Gửi lệnh' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('cmd-reason')).toHaveTextContent('Đang có task chạy (#13)');
  });

  it('shows the empty history state and the first-visit hint', async () => {
    renderScenario('empty-history');
    await advance(1000);
    expect(screen.getByText(/Chưa có task nào trong phiên này\./)).toBeInTheDocument();
    expect(screen.getByTestId('first-visit-hint')).toBeInTheDocument();
  });

  it('Board not connected: critical banner, Send locked with the reason, no Reconnect USB', async () => {
    renderScenario('board-offline');
    await advance(1500);
    const banner = screen.getByRole('alert');
    expect(within(banner).getByText('Board chưa kết nối')).toBeInTheDocument();
    expect(screen.getByTestId('cmd-reason')).toHaveTextContent(
      'Board chưa kết nối. Đợi Board kết nối với sim.',
    );
    expect(screen.getByRole('button', { name: 'Gửi lệnh' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('button', { name: /Kết nối lại USB/ })).not.toBeInTheDocument();
  });

  it('LIBERO mode hides the SO-101 views with a reason and shows the end-effector pose', async () => {
    renderScenario('running');
    await advance(1500);
    expect(screen.getAllByTestId('libero-hidden')[0]).toHaveTextContent(
      'Sim hiện là tay Franka, không có góc khớp SO-101',
    );
    const pose = screen.getByTestId('ee-pose');
    expect(within(pose).getByText('Đầu tay Franka')).toBeInTheDocument();
    expect(pose.querySelector('[data-row="x"] td:last-child')).toHaveTextContent(/mm$/);
    expect(pose.querySelector('[data-row="step"] td:last-child')).toHaveTextContent(/^\d+ \/ 800$/);
    expect(screen.getByTestId('run-chip')).toHaveTextContent('Đang chạy');
    expect(screen.getByTestId('cmd-description')).toHaveTextContent(
      'pick up the alphabet soup and place it in the basket',
    );
  });

  it('switches language', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('idle');
    await user.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('button', { name: 'Send command' })).toBeInTheDocument();
  });
});
