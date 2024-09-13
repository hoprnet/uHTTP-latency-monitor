import prom from 'prom-client';
import { Routing } from '@hoprnet/uhttp-lib';

import Version from './version';
import log from './logger';
import * as runner from './runner';

type UHTTPsettings = Routing.Settings & { uClientId: string; rpcProvider: string };

type Settings = {
    pushGateway: string;
    intervalMs: number;
    offsetMs: number;
    metricLabels: Record<string, string>;
    metrics: Record<string, prom.Summary | prom.Counter>;
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
        throw new Error("Missing 'UHTTP_LM_PUSH_GATEWAY' env var");
    }

    if (!process.env.UHTTP_LM_METRIC_INSTANCE) {
        throw new Error("Missing 'UHTTP_LM_METRIC_INSTANCE' env var");
    }

    if (!process.env.UHTTP_LM_METRIC_REGION) {
        throw new Error("Missing 'UHTTP_LM_METRIC_REGION' env var");
    }

    if (!process.env.UHTTP_LM_METRIC_ZONE) {
        throw new Error("Missing 'UHTTP_LM_METRIC_ZONE' env var");
    }

    if (!process.env.UHTTP_LM_METRIC_LOCATION) {
        throw new Error("Missing 'UHTTP_LM_METRIC_LOCATION' env var");
    }

    if (!process.env.UHTTP_LM_METRIC_LATITUDE) {
        throw new Error("Missing 'UHTTP_LM_METRIC_LATITUDE' env var");
    }

    if (!process.env.UHTTP_LM_METRIC_LONGITUDE) {
        throw new Error("Missing 'UHTTP_LM_METRIC_LONGITUDE' env var");
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
    const settings: Settings = {
        pushGateway,
        intervalMs,
        offsetMs,
        metrics: {},
        metricLabels: {
            hops: forceZeroHop ? '0' : '1',
            instance: process.env.UHTTP_LM_METRIC_INSTANCE,
            region: process.env.UHTTP_LM_METRIC_REGION,
            zone: process.env.UHTTP_LM_METRIC_ZONE,
            location: process.env.UHTTP_LM_METRIC_LOCATION,
            latitude: process.env.UHTTP_LM_METRIC_LATITUDE,
            longitude: process.env.UHTTP_LM_METRIC_LONGITUDE,
        },
    };
    const logOpts = {
        uHTTPsettings,
        settings,
    };

    const labelNames = Object.keys(settings.metricLabels);
    settings.metrics['errorSum'] = new prom.Counter({
        name: `uhttp_error`,
        help: 'Error counter measuring latency',
        labelNames,
    });

    settings.metrics['fetchSum'] = new prom.Summary({
        name: `uhttp_latency_milliseconds`,
        help: 'Total latency of successful request',
        labelNames,
        percentiles: [0.5, 0.7, 0.9, 0.99],
    });

    settings.metrics['rpcSum'] = new prom.Summary({
        name: `uhttp_rpc_call_milliseconds`,
        help: 'The total duration of a round-trip RPC call',
        labelNames,
        percentiles: [0.5, 0.7, 0.9, 0.99],
    });

    settings.metrics['exitAppSum'] = new prom.Summary({
        name: `uhttp_exit_app_milliseconds`,
        help: 'Approximate total execution time spent in the exit application, excluding RPC call duration',
        labelNames,
        percentiles: [0.5, 0.7, 0.9, 0.99],
    });

    settings.metrics['segSum'] = new prom.Summary({
        name: `uhttp_segment_sending_milliseconds`,
        help: 'Total duration of sending all segments to the hoprd entry node, including acknowledgment receipt',
        labelNames,
        percentiles: [0.5, 0.7, 0.9, 0.99],
    });

    settings.metrics['hoprSum'] = new prom.Summary({
        name: `uhttp_hopr_network_milliseconds`,
        help: 'Estimated duration through the HOPR mixnet back and forth',
        labelNames,
        percentiles: [0.5, 0.7, 0.9, 0.99],
    });

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
    log.info('Delaying first tick by %dms offset', settings.offsetMs);
}

function tick(uClient: Routing.Client, uHTTPsettings: UHTTPsettings, settings: Settings) {
    log.info('Executing latency tick - scheduled to execute every %dms', settings.intervalMs);
    runner
        .once(uClient, uHTTPsettings.rpcProvider)
        .then(collectMetrics(settings.metrics as Record<string, prom.Summary>))
        .catch(reportError(settings.metrics['errorSum'] as prom.Counter))
        .finally(pushMetrics(settings));
}

function collectMetrics(metrics: Record<string, prom.Summary>) {
    return function (metricsDurations: runner.Durations) {
        metrics['fetchSum'].observe(metricsDurations.fetchDur);
        metrics['rpcSum'].observe(metricsDurations.rpcDur);
        metrics['exitAppSum'].observe(metricsDurations.exitAppDur);
        metrics['segSum'].observe(metricsDurations.segDur);
        metrics['hoprSum'].observe(metricsDurations.hoprDur);
    };
}

function reportError(errorCounter: prom.Counter) {
    return function (err: Error) {
        log.error('Error trying to check latency: %s', err);
        errorCounter.inc();
    };
}

function pushMetrics(settings: Settings) {
    return function () {
        const gateway = new prom.Pushgateway(settings.pushGateway);
        gateway
            .push({ jobName: settings.metricLabels.instance, groupings: settings.metricLabels })
            .then(() => {
                log.info('Latency Monitor[%s] Metrics pushed correctly', Version);
            })
            .catch((err) => {
                log.error('Error pushing metrics to %s: %s', settings.pushGateway, err);
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
