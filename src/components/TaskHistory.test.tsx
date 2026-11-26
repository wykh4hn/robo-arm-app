import { act, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { initialUi, useStore } from '../state/store';
import { liberoHealthFixture, liberoStateFixture } from '../test/fixtures/libero';
import { TaskHistory } from './TaskHistory';

describe('TaskHistory LIBERO episode', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({
      ...initialUi(),
      lang: 'en',
      web: 'connected',
      synced: true,
      lastMessageAt: Date.now(),
    });
  });

  it('marks a task the Board runner started on its own (Q1)', () => {
    useStore.setState({
      tasks: [
        { id: 2, command: 'pick up the bowl', state: 'running', startedTs: Date.now(), source: 'board' },
        { id: 1, command: 'from the web', state: 'done', startedTs: Date.now() - 9000, source: 'web' },
      ],
    });
    render(<TaskHistory />);
    expect(screen.getAllByText(/Started on the Board/)).toHaveLength(1);
  });

  it('shows native status, session, HOLD and progress when max_steps is valid', () => {
    useStore.setState({ libero: liberoStateFixture, liberoConnectionHealth: liberoHealthFixture });
    render(<TaskHistory />);

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Session active')).toBeInTheDocument();
    expect(screen.getByText('HOLD: Clear')).toBeInTheDocument();
    expect(screen.getByLabelText('Episode progress')).toHaveTextContent('25%');
    expect(screen.getByText('Step: 25 / 100')).toBeInTheDocument();
  });

  it('only reports a terminal outcome when the terminal state is fresh and connected', () => {
    const ended = {
      ...liberoStateFixture,
      status: 'SUCCESS' as const,
      session_active: false,
      end_reason: 'TASK_SUCCESS',
    };
    useStore.setState({ libero: ended, liberoConnectionHealth: liberoHealthFixture });
    const { rerender } = render(<TaskHistory />);
    expect(screen.getByText('Confirmed outcome: Success')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === 'End reason: TASK_SUCCESS')).toBeInTheDocument();

    act(() => {
      useStore.setState({
        liberoConnectionHealth: { ...liberoHealthFixture, last_state_age_ms: 5000 },
      });
    });
    rerender(<TaskHistory />);
    expect(screen.queryByText('Confirmed outcome: Success')).not.toBeInTheDocument();
    expect(screen.getAllByText(/State stale/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Terminal outcome not confirmed/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/State stale/);
    expect(screen.queryByText('TASK_SUCCESS')).not.toBeInTheDocument();
  });

  it('does not calculate progress for invalid max_steps or show a terminal result for a running episode', () => {
    useStore.setState({
      libero: { ...liberoStateFixture, max_steps: 0 },
      liberoConnectionHealth: liberoHealthFixture,
    });
    render(<TaskHistory />);
    expect(screen.queryByLabelText('Episode progress')).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirmed outcome/)).not.toBeInTheDocument();
  });

  it('withholds terminal outcome while the latest simulator poll has failed', () => {
    useStore.setState({
      libero: { ...liberoStateFixture, status: 'SUCCESS', end_reason: 'TASK_SUCCESS' },
      liberoConnectionHealth: { ...liberoHealthFixture, sim: 'offline', last_state_age_ms: null },
    });
    render(<TaskHistory />);

    expect(screen.queryByText('Confirmed outcome: Success')).not.toBeInTheDocument();
    expect(screen.getByText(/Terminal outcome not confirmed/)).toBeInTheDocument();
    expect(screen.queryByText('TASK_SUCCESS')).not.toBeInTheDocument();
  });

  it('posts one RESET request and accepts only a verified new READY run', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...liberoStateFixture, run_id: 'run-2', status: 'READY', hold_latched: false }),
    });
    vi.stubGlobal('fetch', fetchMock);
    useStore.setState({ libero: { ...liberoStateFixture, status: 'SUCCESS' } });

    await act(async () => useStore.getState().resetLiberoEpisode());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/libero/reset');
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({ id: expect.any(String) });
    expect(useStore.getState().liberoReset.phase).toBe('done');
    expect(useStore.getState().libero?.run_id).toBe('run-2');
  });

  it('keeps RESET outcome unknown and does not retry after an ambiguous timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 504,
      json: async () => ({ detail: { code: 'outcome_unknown', reason: 'check state' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    useStore.setState({ libero: { ...liberoStateFixture, status: 'SUCCESS' } });

    await act(async () => useStore.getState().resetLiberoEpisode());
    await act(async () => useStore.getState().resetLiberoEpisode());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(useStore.getState().liberoReset.phase).toBe('outcome_unknown');
  });
});
