import prom from 'prom-client';

import Version from './version';
import log from './logger';
import * as runner from './runner';

// if this file is the entrypoint of the nodejs process
if (require.main === module) {
    if (!process.env.UHTTP_LM_CLIENT_ID) {
        throw new Error("Missing 'UHTTP_LM_CLIENT_ID' env var.");
    }
    if (!process.env.UHTTP_LM_RPC_PROVIDER) {
        throw new Error("Missing 'UHTTP_LM_RPC_PROVIDER' env var.");
    }
    if (!process.env.UHTTP_LM_ZERO_HOP) {
        throw new Error("Missing 'UHTTP_LM_ZERO_HOP' env var.");
    }
    if (!process.env.UHTTP_LM_LOCATION) {
        log.warn("'UHTTP_LM_LOCATION' not set, using 'unset'.");
    }
    let location = process.env.UHTTP_LM_LOCATION || '';
    location.trim();
    if (!location) {
        location = 'unset';
    }
    if (!process.env.UHTTP_LM_PUSH_GATEWAY) {
        log.warn("'UHTTP_LM_PUSH_GATEWAY' not set, disabling metrics pushing");
    }
    const pushGateway = process.env.UHTTP_LM_PUSH_GATEWAY;

    const forceZeroHop = parseBooleanEnv(process.env.UHTTP_LM_ZERO_HOP);
    const hops = forceZeroHop ? 0 : 1;
    const ops = {
        uhttpClientId: process.env.UHTTP_LM_CLIENT_ID,
        rpcProvider: process.env.UHTTP_LM_RPC_PROVIDER,
        forceZeroHop,
    };
    const logOps = {
        rpcProvider: ops.rpcProvider,
    };
    log.info('Latency Monitor[%s] started with %o', Version, logOps);

    runner
        .once(ops)
        .then(collectMetrics(hops, location))
        .catch(reportError(hops, location))
        .finally(pushMetrics(pushGateway));
}

function collectMetrics(hops: number, location: string) {
    return function (metrics: runner.Durations) {
        const fetchSum = new prom.Summary({
            name: `uhttp_latency_milliseconds`,
            help: 'Total latency of successful request',
            labelNames: ['hops', 'location'] as const,
            percentiles: [0.5, 0.7, 0.9, 0.99],
        });
        const rpcSum = new prom.Summary({
            name: `uhttp_rpc_call_milliseconds`,
            help: 'The total duration of a round-trip RPC call',
            labelNames: ['hops', 'location'] as const,
            percentiles: [0.5, 0.7, 0.9, 0.99],
        });
        const exitAppSum = new prom.Summary({
            name: `uhttp_exit_app_milliseconds`,
            help: 'Approximate total execution time spent in the exit application, excluding RPC call duration',
            labelNames: ['hops', 'location'] as const,
            percentiles: [0.5, 0.7, 0.9, 0.99],
        });
        const segSum = new prom.Summary({
            name: `uhttp_segment_sending_milliseconds`,
            help: 'Total duration of sending all segments to the hoprd entry node, including acknowledgment receipt',
            labelNames: ['hops', 'location'] as const,
            percentiles: [0.5, 0.7, 0.9, 0.99],
        });
        const hoprSum = new prom.Summary({
            name: `uhttp_hopr_network_milliseconds`,
            help: 'Estimated duration through the HOPR mixnet back and forth',
            labelNames: ['hops', 'location'] as const,
            percentiles: [0.5, 0.7, 0.9, 0.99],
        });
        fetchSum.observe({ hops, location }, metrics.fetchDur);
        rpcSum.observe({ hops, location }, metrics.rpcDur);
        exitAppSum.observe({ hops, location }, metrics.exitAppDur);
        segSum.observe({ hops, location }, metrics.segDur);
        hoprSum.observe({ hops, location }, metrics.hoprDur);
    };
}

function reportError(hops: number, location: string) {
    return function (err: Error) {
        log.error('Error trying to check latency: %s', err);
        const errorSum = new prom.Summary({
            name: `uhttp_error`,
            help: 'Latency measure not possible due to error',
            labelNames: ['hops', 'location'] as const,
        });
        errorSum.observe({ hops, location }, 0);
    };
}

function pushMetrics(pushGateway?: string) {
    return function () {
        if (!pushGateway) {
            log.info('Latency Monitor[%s] finished without pushing metrics', Version);
            return;
        }
        const gateway = new prom.Pushgateway(pushGateway);
        gateway
            .pushAdd({ jobName: 'uhttp-latency-monitor' })
            .then(() => {
                log.info('Latency Monitor[%s] finished run successfully', Version);
            })
            .catch((err) => {
                log.error('Error pushing metrics to %s: %s', pushGateway, err);
            });
    };
}

function parseBooleanEnv(env?: string): boolean {
    if (env) {
        return (
            '1' === env.toLowerCase() || 'yes' === env.toLowerCase() || 'true' === env.toLowerCase()
        );
    }
    return false;
}
