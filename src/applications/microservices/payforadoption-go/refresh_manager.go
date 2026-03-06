/*
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
*/
package main

import (
	"context"
	"os"
	"strconv"
	"sync"
	"time"

	"petadoptions/payforadoption"
)

type cachedValue struct {
	value     interface{}
	timestamp time.Time
}

type RefreshManager struct {
	refreshInterval time.Duration
	paramCache      map[string]*cachedValue
	secretCache     *cachedValue
	mu              sync.RWMutex
}

func NewRefreshManager() *RefreshManager {
	intervalStr := os.Getenv("CONFIG_REFRESH_INTERVAL")
	interval := 300 // default 5 minutes
	if intervalStr != "" {
		if val, err := strconv.Atoi(intervalStr); err == nil {
			interval = val
		}
	}

	var refreshInterval time.Duration
	if interval == -1 {
		refreshInterval = -1
	} else {
		refreshInterval = time.Duration(interval) * time.Second
	}

	return &RefreshManager{
		refreshInterval: refreshInterval,
		paramCache:      make(map[string]*cachedValue),
	}
}

func (rm *RefreshManager) shouldRefreshParams() bool {
	if rm.refreshInterval == -1 {
		return false
	}

	rm.mu.RLock()
	defer rm.mu.RUnlock()

	if len(rm.paramCache) == 0 {
		return true
	}

	for _, cached := range rm.paramCache {
		if time.Since(cached.timestamp) > rm.refreshInterval {
			return true
		}
	}
	return false
}

func (rm *RefreshManager) shouldRefreshSecret() bool {
	if rm.refreshInterval == -1 {
		return false
	}

	rm.mu.RLock()
	defer rm.mu.RUnlock()

	if rm.secretCache == nil {
		return true
	}

	return time.Since(rm.secretCache.timestamp) > rm.refreshInterval
}

func (rm *RefreshManager) cacheConfig(cfg payforadoption.Config) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	now := time.Now()
	rm.paramCache["UpdateAdoptionURL"] = &cachedValue{cfg.UpdateAdoptionURL, now}
	rm.paramCache["S3BucketName"] = &cachedValue{cfg.S3BucketName, now}
	rm.paramCache["DynamoDBTable"] = &cachedValue{cfg.DynamoDBTable, now}
	rm.paramCache["SQSQueueURL"] = &cachedValue{cfg.SQSQueueURL, now}
	rm.paramCache["RDSSecretArn"] = &cachedValue{cfg.RDSSecretArn, now}
}

func (rm *RefreshManager) getCachedConfig(baseCfg payforadoption.Config) (payforadoption.Config, bool) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	if len(rm.paramCache) == 0 {
		return baseCfg, false
	}

	cfg := baseCfg
	if val, ok := rm.paramCache["UpdateAdoptionURL"]; ok {
		cfg.UpdateAdoptionURL = val.value.(string)
	}
	if val, ok := rm.paramCache["S3BucketName"]; ok {
		cfg.S3BucketName = val.value.(string)
	}
	if val, ok := rm.paramCache["DynamoDBTable"]; ok {
		cfg.DynamoDBTable = val.value.(string)
	}
	if val, ok := rm.paramCache["SQSQueueURL"]; ok {
		cfg.SQSQueueURL = val.value.(string)
	}
	if val, ok := rm.paramCache["RDSSecretArn"]; ok {
		cfg.RDSSecretArn = val.value.(string)
	}

	return cfg, true
}

func (rm *RefreshManager) cacheSecret(secret string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.secretCache = &cachedValue{secret, time.Now()}
}

func (rm *RefreshManager) getCachedSecret() (string, bool) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	if rm.secretCache == nil {
		return "", false
	}
	return rm.secretCache.value.(string), true
}

func (rm *RefreshManager) fetchConfigIfNeeded(ctx context.Context, baseCfg payforadoption.Config) (payforadoption.Config, error) {
	if !rm.shouldRefreshParams() {
		if cfg, ok := rm.getCachedConfig(baseCfg); ok {
			InfoWithTrace(ctx, "Using cached configuration parameters\n")
			return cfg, nil
		}
	}

	InfoWithTrace(ctx, "Refreshing configuration parameters from Parameter Store\n")
	cfg, err := fetchConfigFromParameterStore(ctx, baseCfg, nil)
	if err != nil {
		return baseCfg, err
	}

	rm.cacheConfig(cfg)
	return cfg, nil
}

func (rm *RefreshManager) StartPeriodicRefresh(ctx context.Context, cfg payforadoption.Config) {
	if rm.refreshInterval == -1 {
		return
	}

	go func() {
		ticker := time.NewTicker(rm.refreshInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if rm.shouldRefreshParams() {
					InfoWithTrace(ctx, "Background refresh: updating parameters\n")
					if newCfg, err := fetchConfigFromParameterStore(ctx, cfg, nil); err == nil {
						rm.cacheConfig(newCfg)
					}
				}
				if rm.shouldRefreshSecret() {
					InfoWithTrace(ctx, "Background refresh: updating secret\n")
					if secret, err := payforadoption.NewDatabaseConfigService(cfg).GetSecretValue(ctx); err == nil {
						rm.cacheSecret(secret)
					}
				}
			}
		}
	}()
}
