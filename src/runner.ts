import { Routing } from '@hoprnet/uhttp-lib';

const READY_TIMEOUT = 10_000; // 10 sec

export type Durations = {
    fetchDur: number;
} & Routing.LatencyStatistics;

export function init(uClientId: string, settings: Routing.Settings): Routing.Client {
    return new Routing.Client(uClientId, { ...settings, measureLatency: true });
}

export async function once(uClient: Routing.Client, rpcProvider: string): Promise<Durations> {
    const id = Math.floor(Math.random() * 100);
    const payload = {
        jsonrpc: '2.0',
        method: 'eth_getBlockTransactionCountByNumber',
        params: ['latest'],
        id: `${id}`,
    };

    const headers = { 'Content-Type': 'application/json' };
    await uClient.isReady(READY_TIMEOUT);

    let latencies: unknown = undefined;
    uClient.onLatencyStatisticsHandler = (lats) => {
        if (Routing.isLatencyStatistics(lats)) {
            latencies = lats;
        }
    };

    const startedAt = performance.now();
    const res = await uClient.fetch(rpcProvider, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers,
    });
    const fetchDur = Math.round(performance.now() - startedAt);

    if (res.ok) {
        const resp = (await res.json()) as { id: string };
        if (resp.id === payload.id) {
            const lats = latencies as Routing.LatencyStatistics;
            return {
                fetchDur,
                ...lats,
            };
        }
        throw new Error('requesterror');
    }
    throw new Error('fetcherror');
}
