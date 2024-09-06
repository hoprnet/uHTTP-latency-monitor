import prom from 'prom-client';
import { Routing } from '@hoprnet/uhttp-lib';

import Version from './version';
import log from './logger';
import * as runner from './runner';

type UHTTPsettings = Routing.Settings & { uClientId: string; rpcProvider: string };

type Settings = {
    pushGateway?: string;
    intervalMs: number;
    offsetMs: number;
};

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
    if (!process.env.UHTTP_LM_DISCOVERY_PLATFORM) {
        throw new Error("Missing 'UHTTP_LM_DISCOVERY_PLATFORM' env var.");
    }
    if (!process.env.UHTTP_LM_INTERVAL_MS) {
        throw new Error("Missing 'UHTTP_LM_INTERVAL_MS' env var.");
    }
    if (!process.env.UHTTP_LM_OFFSET_MS) {
        throw new Error("Missing 'UHTTP_LM_OFFSET_MS' env var.");
    }
    if (!process.env.UHTTP_LM_PUSH_GATEWAY) {
        log.warn("'UHTTP_LM_PUSH_GATEWAY' not set, disabling metrics pushing");
    }

    const uClientId = process.env.UHTTP_LM_CLIENT_ID;
    const rpcProvider = process.env.UHTTP_LM_RPC_PROVIDER;
    const forceZeroHop = parseBooleanEnv(process.env.UHTTP_LM_ZERO_HOP);
    const discoveryPlatformEndpoint = process.env.UHTTP_LM_DISCOVERY_PLATFORM;
    const intervalMs = parseInt(process.env.UHTTP_LM_INTERVAL_MS);
    if (!intervalMs) {
        throw new Error("failed to parse 'UHTTP_LM_INTERVAL_MS' as integer value");
    }
    const offsetMs = parseInt(process.env.UHTTP_LM_OFFSET_MS);
    if (!offsetMs) {
        throw new Error("failed to parse 'UHTTP_LM_OFFSET_MS' as integer value");
    }
    const pushGateway = process.env.UHTTP_LM_PUSH_GATEWAY;

    const uHTTPsettings = {
        uClientId,
        discoveryPlatformEndpoint,
        forceZeroHop,
        rpcProvider,
    };
    const settings = {
        pushGateway,
        intervalMs,
        offsetMs,
    };
    const logOpts = {
        uHTTPsettings,
        settings,
    };
    log.info('Latency Monitor[%s] started with %o', Version, logOpts);

    start(uHTTPsettings, settings);
}

function start(uHTTPsettings: UHTTPsettings, settings: Settings) {
    const uClient = runner.init(uHTTPsettings.uClientId, uHTTPsettings);

    setTimeout(() => {
        tick(uClient, uHTTPsettings, settings);
        setInterval(() => {
            tick(uClient, uHTTPsettings, settings);
        }, settings.intervalMs);
    }, settings.offsetMs);
    log.info('Delaying first tick by %s ms offset', settings.offsetMs);
}

function tick(uClient: Routing.Client, uHTTPsettings: UHTTPsettings, settings: Settings) {
    log.info('Executing latency tick - scheduled to execute every %s ms', settings.intervalMs);
    const hops = uHTTPsettings.forceZeroHop ? 0 : 1;
    runner
        .once(uClient, uHTTPsettings.rpcProvider)
        .then(collectMetrics(hops))
        .catch(reportError(hops))
        .finally(pushMetrics(settings.pushGateway));
}

function collectMetrics(hops: number) {
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
        fetchSum.observe({ hops }, metrics.fetchDur);
        rpcSum.observe({ hops }, metrics.rpcDur);
        exitAppSum.observe({ hops }, metrics.exitAppDur);
        segSum.observe({ hops }, metrics.segDur);
        hoprSum.observe({ hops }, metrics.hoprDur);
    };
}

function reportError(hops: number) {
    return function (err: Error) {
        log.error('Error trying to check latency: %s', err);
        const errorSum = new prom.Summary({
            name: `uhttp_error`,
            help: 'Latency measure not possible due to error',
            labelNames: ['hops', 'location'] as const,
        });
        errorSum.observe({ hops }, 0);
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
