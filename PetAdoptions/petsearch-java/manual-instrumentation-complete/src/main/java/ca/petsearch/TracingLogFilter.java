package ca.petsearch;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.filter.Filter;
import ch.qos.logback.core.spi.FilterReply;
import io.opentelemetry.api.trace.Span;
import org.slf4j.MDC;

public class TracingLogFilter extends Filter<ILoggingEvent> {
    @Override
    public FilterReply decide(ILoggingEvent event) {
        Span span = Span.current();

        if (span == Span.getInvalid()) {
            MDC.remove("AWS-XRAY-TRACE-ID");
            return FilterReply.ACCEPT;
        }

        String traceId = span.getSpanContext().getTraceId();
        String entityId = span.getSpanContext().getSpanId();

        String traceLog = "1-"
                + traceId.substring(0, 8)
                + "-"
                + traceId.substring(8)
                + "@"
                + entityId;
        MDC.put("AWS-XRAY-TRACE-ID", traceLog);

        return FilterReply.ACCEPT;
    }
}
