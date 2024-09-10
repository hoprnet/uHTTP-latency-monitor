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
    metricLabels: { [key: string]: string };
    metrics: {[key:string]: prom.Summary};
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
    const settings: Settings = {
        pushGateway,
        intervalMs,
        offsetMs,
        metrics: {},
        metricLabels: {
            hops: forceZeroHop ? '0' : '1',
        },
    };
    const logOpts = {
        uHTTPsettings,
        settings,
    };

    if (process.env.UHTTP_LM_METRIC_INSTANCE !== undefined) {
        settings.metricLabels['instance'] = process.env.UHTTP_LM_METRIC_INSTANCE;
    }

    if (process.env.UHTTP_LM_METRIC_REGION !== undefined) {
        settings.metricLabels['region'] = process.env.UHTTP_LM_METRIC_REGION;
    }

    if (process.env.UHTTP_LM_METRIC_ZONE !== undefined) {
        settings.metricLabels['zone'] = process.env.UHTTP_LM_METRIC_ZONE;
    }

    if (process.env.UHTTP_LM_METRIC_LOCATION !== undefined) {
        settings.metricLabels['location'] = process.env.UHTTP_LM_METRIC_LOCATION;
    }

    if (process.env.UHTTP_LM_METRIC_LATITUDE !== undefined) {
        settings.metricLabels['latitude'] = process.env.UHTTP_LM_METRIC_LATITUDE;
    }

    if (process.env.UHTTP_LM_METRIC_LONGITUDE !== undefined) {
        settings.metricLabels['longitude'] = process.env.UHTTP_LM_METRIC_LONGITUDE;
    }

    const labelNames = Object.keys(settings.metricLabels);
    settings.metrics['errorSum'] = new prom.Summary({
        name: `uhttp_error`,
        help: 'Latency measure not possible due to error',
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

    settings.metrics['hoprSum'] =new prom.Summary({
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
    const hops = uHTTPsettings.forceZeroHop ? 0 : 1;
    runner
        .once(uClient, uHTTPsettings.rpcProvider)
        .then(collectMetrics(settings.metrics, settings.metricLabels))
        .catch(reportError(settings.metrics, settings.metricLabels))
        .finally(pushMetrics(settings.pushGateway));
}

function collectMetrics(metrics: { [key: string]: prom.Summary }, metricLabels: { [key: string]: string }) {
    return function (metricsDurations: runner.Durations) {
        metrics['fetchSum'].observe(metricLabels, metricsDurations.fetchDur);
        metrics['rpcSum'].observe(metricLabels, metricsDurations.rpcDur);
        metrics['exitAppSum'].observe(metricLabels, metricsDurations.exitAppDur);
        metrics['segSum'].observe(metricLabels, metricsDurations.segDur);
        metrics['hoprSum'].observe(metricLabels, metricsDurations.hoprDur);
    };
}

function reportError(metrics: { [key: string]: prom.Summary }, metricLabels: { [key: string]: string }) {
    return function (err: Error) {
        log.error('Error trying to check latency: %s', err);
        metrics['errorSum'].observe(metricLabels, 0);
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
