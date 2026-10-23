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
    expect(screen.getByTestId('cmd-reason')).toHaveTextContent('Bấm Sẵn sàng');
    // Robot never restarts by itself: Ready is required, then a new command.
    await user.click(screen.getByRole('button', { name: 'Sẵn sàng' }));
    await advance(400);
    expect(screen.getByTestId('lamp')).toHaveTextContent('Hệ thống ổn');
    expect(screen.queryByTestId('cmd-reason')).not.toBeInTheDocument();
  });

  it('without a stop ACK it says to use the physical emergency stop', async () => {
    renderScenario('stop-no-ack');
    await advance(1500);
    await act(async () => stopButton().click());
    await advance(2100);
    expect(stopButton()).toHaveTextContent('Chưa xác nhận dừng');
    expect(screen.getByText('Dùng nút dừng khẩn cấp vật lý trên robot.')).toBeInTheDocument();
    const banner = screen.getByRole('alert');
    expect(within(banner).getByText(/Chưa xác nhận lệnh dừng sau 2 s/)).toBeInTheDocument();
  });

  it('shows the exact command, the NACK reason, and never a success state', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('cmd-nack');
    await advance(1500);
    await user.selectOptions(screen.getByLabelText('Vật thể'), 'yellow_duck');
    expect(screen.getByTestId('cmd-preview')).toHaveTextContent(
      'pick the yellow duck and put it in the box',
    );
    await user.click(screen.getByRole('button', { name: 'Gửi lệnh' }));
    expect(screen.getByTestId('cmd-lifecycle')).toHaveAttribute('data-phase', 'sent');
    await advance(300);
    const lifecycle = screen.getByTestId('cmd-lifecycle');
    expect(lifecycle).toHaveAttribute('data-phase', 'rejected');
    expect(lifecycle).not.toHaveTextContent('Xong');
    expect(lifecycle).toHaveTextContent('không thấy vật trong hình camera');
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

  it('USB lost: critical banner with Reconnect; it clears only when the condition clears', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('usb-lost');
    await advance(4000);
    expect(screen.getByText('Mất kết nối USB với tay robot')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Kết nối lại USB/ }));
    await advance(1500);
    expect(screen.queryByText('Mất kết nối USB với tay robot')).not.toBeInTheDocument();
    expect(screen.getByTestId('lamp')).toHaveTextContent('Chờ người dùng');
  });

  it('runs without the URDF / WebGL and renders the joint table', async () => {
    renderScenario('no-urdf');
    await advance(1500);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(screen.getByText(/không hỗ trợ WebGL/)).toBeInTheDocument();
  });

  it('switches language', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('idle');
    await user.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('button', { name: 'Send command' })).toBeInTheDocument();
  });
});
