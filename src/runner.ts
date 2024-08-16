import { Routing } from '@hoprnet/uhttp-lib';

type Ops = {
    rpcProvider: string;
    uhttpClientId: string;
    forceZeroHop: boolean;
};

const READY_TIMEOUT = 10_000; // 10 sec

export type Durations = {
    fetchDur: number;
} & Routing.LatencyStatistics;

export async function once(ops: Ops): Promise<Durations> {
    const uClient = new Routing.Client(ops.uhttpClientId, {
        forceZeroHop: ops.forceZeroHop,
        measureLatency: true,
    });
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
    const res = await uClient.fetch(ops.rpcProvider, {
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
