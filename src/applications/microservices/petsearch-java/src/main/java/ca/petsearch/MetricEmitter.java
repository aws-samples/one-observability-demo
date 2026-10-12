/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package ca.petsearch;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.DoubleHistogram;
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.LongHistogram;
import io.opentelemetry.api.metrics.Meter;

/**
 * Custom business metrics for the pet search API, recorded through the OpenTelemetry API.
 *
 * <p>The ADOT Java agent provides the SDK at runtime and exports these over OTLP to the
 * CloudWatch agent sidecar, which forwards them to the CloudWatch OTLP metrics endpoint.
 * Names and units follow OpenTelemetry conventions; per-task identity comes from resource
 * attributes, so it is never baked into metric names. Attribute values are kept to small,
 * fixed sets to bound cardinality.
 */
public class MetricEmitter {

    static final AttributeKey<String> HTTP_ROUTE = AttributeKey.stringKey("http.route");
    static final AttributeKey<String> HTTP_STATUS_CODE = AttributeKey.stringKey("http.response.status_code");
    static final AttributeKey<String> PET_TYPE = AttributeKey.stringKey("pet.type");

    static final String REQUEST_DURATION_METRIC = "petsearch.request.duration";
    static final String RESPONSE_SIZE_METRIC = "petsearch.response.size";
    static final String PETS_RETURNED_METRIC = "petsearch.pets.returned";

    private final DoubleHistogram requestDuration;
    private final LongHistogram responseSize;
    private final LongCounter petsReturned;

    public MetricEmitter(OpenTelemetry otel) {
        Meter meter = otel.meterBuilder("ca.petsearch").setInstrumentationVersion("1.0").build();

        requestDuration = meter
                .histogramBuilder(REQUEST_DURATION_METRIC)
                .setDescription("Duration of pet search API requests")
                .setUnit("s")
                .build();

        responseSize = meter
                .histogramBuilder(RESPONSE_SIZE_METRIC)
                .ofLongs()
                .setDescription("Size of pet search API response bodies")
                .setUnit("By")
                .build();

        petsReturned = meter
                .counterBuilder(PETS_RETURNED_METRIC)
                .setDescription("Number of pets returned by searches")
                .setUnit("{pet}")
                .build();
    }

    public void emitRequestDuration(double seconds, String route, String statusCode) {
        requestDuration.record(seconds, Attributes.of(HTTP_ROUTE, route, HTTP_STATUS_CODE, statusCode));
    }

    public void emitResponseSize(long bytes, String route, String statusCode) {
        responseSize.record(bytes, Attributes.of(HTTP_ROUTE, route, HTTP_STATUS_CODE, statusCode));
    }

    /**
     * @param petsCount number of pets in the search result
     * @param petType   validated pet type, or empty for an unfiltered search
     */
    public void emitPetsReturnedMetric(int petsCount, String petType) {
        String type = petType == null || petType.trim().isEmpty() ? "all" : petType;
        petsReturned.add(petsCount, Attributes.of(PET_TYPE, type));
    }

}
