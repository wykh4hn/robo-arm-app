import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveStatus } from '../state/deriveStatus';
import { initialMonitorState, initialUi, useStore } from '../state/store';
import { liberoHealthFixture } from '../test/fixtures/libero';
import { StatusBar } from './StatusBar';

describe('StatusBar LIBERO health', () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({ ...initialUi(), lang: 'en' });
  });

  it('shows simulator health separately from the WebSocket connection', () => {
    useStore.setState({
      web: 'connected',
      synced: true,
      liberoConnectionHealth: { ...liberoHealthFixture, simulator_connection: 'disconnected' },
    });
    render(<StatusBar derived={deriveStatus({ ...initialMonitorState(1000), ...useStore.getState() })} />);

    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('Connection').parentElement).toHaveTextContent('Web · reloading state');
    expect(screen.getByText('LIBERO simulator')).toBeInTheDocument();
    expect(screen.getByText('Simulator disconnected')).toBeInTheDocument();
  });

  it('marks stale LIBERO state visibly', () => {
    useStore.setState({
      liberoConnectionHealth: { ...liberoHealthFixture, state_freshness: 'stale' },
    });
    render(<StatusBar derived={deriveStatus({ ...initialMonitorState(1000), ...useStore.getState() })} />);

    expect(screen.getByText('State stale')).toBeInTheDocument();
  });

  it('does not present a cached healthy simulator snapshot as live after WebSocket loss', () => {
    useStore.setState({
      web: 'disconnected',
      synced: false,
      liberoConnectionHealth: { ...liberoHealthFixture },
    });
    render(<StatusBar derived={deriveStatus({ ...initialMonitorState(1000), ...useStore.getState() })} />);

    expect(screen.getByText('Connection').parentElement).toHaveTextContent('Web lost');
    expect(screen.getByText('State stale')).toBeInTheDocument();
  });

  it('keeps the simulator snapshot stale during reconnect until a fresh state arrives', () => {
    useStore.setState({
      web: 'connected',
      synced: false,
      liberoConnectionHealth: { ...liberoHealthFixture },
    });
    render(<StatusBar derived={deriveStatus({ ...initialMonitorState(1000), ...useStore.getState() })} />);

    expect(screen.getByText('State stale')).toBeInTheDocument();
  });
});
