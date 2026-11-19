/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package ca.petsearch;

import org.springframework.web.util.ContentCachingResponseWrapper;

import javax.servlet.*;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

public class ApplicationFilter implements Filter {

    private final MetricEmitter metricEmitter;

    public ApplicationFilter(MetricEmitter metricEmitter) {
        this.metricEmitter = metricEmitter;
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) throws IOException, ServletException {

        long requestStartNanos = System.nanoTime();

        ContentCachingResponseWrapper responseWrapper = new ContentCachingResponseWrapper((HttpServletResponse) response);

        chain.doFilter(request, responseWrapper);

        int loadSize = responseWrapper.getContentSize();

        responseWrapper.copyBodyToResponse();

        String statusCode = String.valueOf(((HttpServletResponse)response).getStatus());
        // The filter is only registered for fixed URL patterns, so the servlet path is a bounded route
        String route = ((HttpServletRequest)request).getServletPath();

        metricEmitter.emitRequestDuration((System.nanoTime() - requestStartNanos) / 1e9, route, statusCode);
        metricEmitter.emitResponseSize(loadSize, route, statusCode);
    }
}
