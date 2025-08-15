/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package ca.petsearch;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.LongHistogram;
import io.opentelemetry.api.metrics.Meter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class MetricEmitter {

    private Logger logger = LoggerFactory.getLogger(MetricEmitter.class);

    static final String DIMENSION_API_NAME = "apiName";
    static final String DIMENSION_STATUS_CODE = "statusCode";

    static String API_COUNTER_METRIC = "apiBytesSent";
    static String API_LATENCY_METRIC = "latency";
    static String PETS_RETURNED_METRIC = "petsReturned";

    private LongCounter apiBytesSentCounter;
    private LongHistogram apiLatencyHistogram;
    private LongCounter petsReturned;

    public MetricEmitter(OpenTelemetry otel) {
        Meter meter = otel.meterBuilder("aws-otel").setInstrumentationVersion("1.0").build();

        logger.debug("OTLP port is: " + System.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"));

        String latencyMetricName = API_LATENCY_METRIC;
        String apiBytesSentMetricName = API_COUNTER_METRIC;
        String petsReturnedMetricName = PETS_RETURNED_METRIC;

        String instanceId = System.getenv("INSTANCE_ID");
        if (instanceId != null && !instanceId.trim().equals("")) {
            latencyMetricName = API_LATENCY_METRIC + "_" + instanceId;
            apiBytesSentMetricName = API_COUNTER_METRIC + "_" + instanceId;
            petsReturnedMetricName = PETS_RETURNED_METRIC + "_" + instanceId;
        }

        apiBytesSentCounter =
                meter
                        .counterBuilder(apiBytesSentMetricName)
                        .setDescription("API request load sent in bytes")
                        .setUnit("one")
                        .build();

        petsReturned =
                meter
                        .counterBuilder(petsReturnedMetricName)
                        .setDescription("Number of pets returned by this service")
                        .setUnit("one")
                        .build();


        apiLatencyHistogram =
                meter
                        .histogramBuilder(latencyMetricName).ofLongs()
                        .setDescription("API latency time")
                        .setUnit("ms")
                        .build();
    }

    /**
     * emit http request latency metrics with summary metric type
     *
     * @param returnTime
     * @param apiName
     * @param statusCode
     */
    public void emitReturnTimeMetric(Long returnTime, String apiName, String statusCode) {
        logger.debug(
                "emit metric with return time " + returnTime + "ms, " + apiName + ", status code:" + statusCode);
        apiLatencyHistogram.record(
                returnTime, Attributes.of(AttributeKey.stringKey(DIMENSION_API_NAME), apiName, AttributeKey.stringKey(DIMENSION_STATUS_CODE), statusCode));
    }

    /**
     * emit http request load size with counter metrics type
     *
     * @param bytes
     * @param apiName
     * @param statusCode
     */
    public void emitBytesSentMetric(int bytes, String apiName, String statusCode) {
        logger.debug("emit metric with http request size " + bytes + " bytes, " + apiName);
        apiBytesSentCounter.add(
                bytes, Attributes.of(AttributeKey.stringKey(DIMENSION_API_NAME), apiName, AttributeKey.stringKey(DIMENSION_STATUS_CODE), statusCode));
    }

    public void emitPetsReturnedMetric(int petsCount) {
        petsReturned.add(petsCount);
    }

}
