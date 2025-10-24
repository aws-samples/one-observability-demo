/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package ca.petsearch;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class ParameterRefreshManager {
    private static final Logger logger = LoggerFactory.getLogger(ParameterRefreshManager.class);

    private final long refreshInterval;
    private final Map<String, CachedParameter> cache = new ConcurrentHashMap<>();

    public ParameterRefreshManager() {
        String intervalStr = System.getenv("CONFIG_REFRESH_INTERVAL");
        this.refreshInterval = (intervalStr != null ? Long.parseLong(intervalStr) : 300) * 1000; // Convert to milliseconds
        logger.info("Parameter refresh interval set to {} ms ({})", refreshInterval,
                   refreshInterval == -1000 ? "disabled" : refreshInterval / 1000 + " seconds");
    }

    public String getCachedParameter(String key) {
        CachedParameter cached = cache.get(key);
        return cached != null ? cached.value : null;
    }

    public void cacheParameter(String key, String value) {
        cache.put(key, new CachedParameter(value, System.currentTimeMillis()));
        logger.debug("Cached parameter: {}", key);
    }

    public boolean shouldRefresh(String key) {
        if (refreshInterval == -1000) {
            return false;
        }

        CachedParameter cached = cache.get(key);
        if (cached == null) {
            return true;
        }

        long elapsed = System.currentTimeMillis() - cached.timestamp;
        boolean shouldRefresh = elapsed > refreshInterval;

        if (shouldRefresh) {
            logger.info("Parameter {} needs refresh (elapsed: {} ms)", key, elapsed);
        }

        return shouldRefresh;
    }

    private static class CachedParameter {
        final String value;
        final long timestamp;

        CachedParameter(String value, long timestamp) {
            this.value = value;
            this.timestamp = timestamp;
        }
    }
}
