import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
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

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
    useStore.getState().reset();
    useStore.setState({ tab: 'monitoring', lang: 'vi' });
  });
  afterEach(() => vi.useRealTimers());

  it('Stop works by keyboard on both tabs and shows "Đã dừng" only after ACK', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('stop-ok');
    await advance(1500);

    await user.click(screen.getByRole('tab', { name: 'Hướng dẫn' }));
    expect(screen.getByRole('heading', { name: 'Hướng dẫn sử dụng' })).toBeInTheDocument();

    const stop = screen.getByRole('button', { name: /Dừng/ });
    stop.focus();
    await user.keyboard('{Enter}');
    expect(stop).toHaveTextContent('Đang dừng');
    await advance(400);
    expect(stop).toHaveTextContent('Đã dừng');

    await user.click(screen.getByRole('tab', { name: 'Giám sát' }));
    expect(screen.getByRole('button', { name: 'Đã dừng' })).toBeInTheDocument();
    expect(screen.getByTestId('cmd-reason')).toHaveTextContent('Sẵn sàng');
  });

  it('warns to use the physical E-stop when the stop is not acknowledged', async () => {
    renderScenario('stop-no-ack');
    await advance(1500);
    screen.getByRole('button', { name: /Dừng/ }).focus();
    await act(async () => {
      screen.getByRole('button', { name: /Dừng/ }).click();
    });
    await advance(2100);
    expect(screen.getAllByText(/nút dừng khẩn vật lý/).length).toBeGreaterThan(0);
  });

  it('shows the NACK reason and never a success state', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('cmd-nack');
    await advance(1500);
    await user.selectOptions(screen.getByLabelText('Vật'), 'red_duck');
    expect(screen.getByTestId('cmd-preview')).toHaveTextContent(
      'pick the red duck and put it in the box',
    );
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    await advance(300);
    const lifecycle = screen.getByTestId('cmd-lifecycle');
    expect(lifecycle).toHaveAttribute('data-phase', 'rejected');
    expect(lifecycle).not.toHaveTextContent('Xong');
    expect(screen.getAllByText(/vật nằm ngoài vùng/).length).toBeGreaterThan(0);
  });

  it('shows the empty history state and the first-run hint', async () => {
    renderScenario('empty-history');
    await advance(1000);
    expect(screen.getByText(/Chưa có nhiệm vụ nào/)).toBeInTheDocument();
    expect(screen.getByTestId('first-run-hint')).toBeInTheDocument();
  });

  it('error banner stays until closed by the user', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('usb-lost');
    await advance(4000);
    expect(screen.getByText('Mất kết nối với cánh tay.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Kết nối lại/ }));
    await advance(1500);
    // Problem resolved, but the alert is latched until closed.
    expect(screen.getByText('Đã hết')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Đóng thông báo/ }));
    expect(screen.queryByText('Mất kết nối với cánh tay.')).not.toBeInTheDocument();
  });

  it('switches language', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScenario('idle');
    await user.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('tab', { name: 'Tutorial' })).toBeInTheDocument();
  });
});
