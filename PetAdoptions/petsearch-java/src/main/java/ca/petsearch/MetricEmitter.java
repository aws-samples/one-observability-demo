package ca.petsearch;

import io.opentelemetry.api.common.Labels;
import io.opentelemetry.api.metrics.*;
import io.opentelemetry.api.trace.SpanBuilder;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.api.trace.TracerProvider;

public class MetricEmitter {

    static final String DIMENSION_API_NAME = "apiName";
    static final String DIMENSION_STATUS_CODE = "statusCode";

    static String API_COUNTER_METRIC = "apiBytesSent";
    static String API_LATENCY_METRIC = "latency";
    static String PETS_RETURNED_METRIC = "petsReturned";

    private LongCounter apiBytesSentCounter;
    private LongValueRecorder apiLatencyRecorder;
    private LongCounter petsReturned;

    private Tracer tracer;

    public MetricEmitter() {
        Meter meter = GlobalMetricsProvider.getMeter("aws-otel", "1.0");

        tracer = TracerProvider.getDefault().get("aws-otel", "1.0");

        System.out.println("OTLP port is: " + System.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"));

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
                        .longCounterBuilder(apiBytesSentMetricName)
                        .setDescription("API request load sent in bytes")
                        .setUnit("one")
                        .build();

        petsReturned =
                meter
                        .longCounterBuilder(petsReturnedMetricName)
                        .setDescription("Number of pets returned by this service")
                        .setUnit("one")
                        .build();


        apiLatencyRecorder =
                meter
                        .longValueRecorderBuilder(latencyMetricName)
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
        System.out.println(
                "emit metric with return time " + returnTime + "ms, " + apiName + ", status code:" + statusCode);
        apiLatencyRecorder.record(
                returnTime, Labels.of(DIMENSION_API_NAME, apiName, DIMENSION_STATUS_CODE, statusCode));
    }

    /**
     * emit http request load size with counter metrics type
     *
     * @param bytes
     * @param apiName
     * @param statusCode
     */
    public void emitBytesSentMetric(int bytes, String apiName, String statusCode) {
        System.out.println("emit metric with http request size " + bytes + " bytes, " + apiName);
        apiBytesSentCounter.add(
                bytes, Labels.of(DIMENSION_API_NAME, apiName, DIMENSION_STATUS_CODE, statusCode));
    }

    public void emitPetsReturnedMetric(int petsCount) {
        petsReturned.add(petsCount);
    }

    public SpanBuilder spanBuilder(String spanName) {
        return tracer.spanBuilder(spanName);
    }

}
