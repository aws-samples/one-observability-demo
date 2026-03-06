/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package ca.petsearch;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import io.opentelemetry.context.propagation.TextMapGetter;
import io.opentelemetry.semconv.trace.attributes.SemanticAttributes;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.servlet.HandlerInterceptor;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.util.Collections;

public class TracingRequestInterceptor implements HandlerInterceptor {

    private Logger logger = LoggerFactory.getLogger(TracingRequestInterceptor.class);

    private Tracer tracer;
    private OpenTelemetry openTelemetry;

    public TracingRequestInterceptor(OpenTelemetry openTelemetry, Tracer tracer) {
        this.tracer = tracer;
        this.openTelemetry = openTelemetry;
    }

    private static final TextMapGetter<HttpServletRequest> getter =
            new TextMapGetter<HttpServletRequest>() {
                @Override
                public Iterable<String> keys(HttpServletRequest carrier) {
                    return Collections.list(carrier.getHeaderNames());
                }

                @Override
                public String get(HttpServletRequest carrier, String key) {
                    return carrier.getHeader(key);
                }
            };

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        logger.info("handling {}", request.toString());
        Context context = openTelemetry.getPropagators().getTextMapPropagator().extract(Context.current(), request, getter);

        Span span = tracer.spanBuilder(String.format("%s %s", request.getMethod(), request.getRequestURI()))
                .setParent(context)
                .setSpanKind(SpanKind.SERVER)
                .startSpan();

        Scope scope = span.makeCurrent();

        request.setAttribute("span", span);
        request.setAttribute("scope", scope);
        return HandlerInterceptor.super.preHandle(request, response, handler);
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) throws Exception {
        Span span = (Span)request.getAttribute("span");
        Scope scope = (Scope)request.getAttribute("scope");

        if (ex != null) {
            span.setStatus(StatusCode.ERROR);
            span.recordException(ex);
        }
        span.setAttribute(SemanticAttributes.HTTP_METHOD, request.getMethod());
        span.setAttribute(SemanticAttributes.HTTP_SCHEME, request.getScheme());
        span.setAttribute(SemanticAttributes.NET_HOST_NAME, request.getRemoteHost());
        span.setAttribute(SemanticAttributes.HTTP_TARGET, request.getRequestURI());
        span.setAttribute(SemanticAttributes.HTTP_STATUS_CODE, response.getStatus());

        scope.close();
        span.end();
        HandlerInterceptor.super.afterCompletion(request, response, handler, ex);
    }
}
