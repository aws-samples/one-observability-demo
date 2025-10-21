use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::info;

#[derive(Clone)]
pub struct CachedParameter {
    pub value: String,
    pub timestamp: Instant,
}

pub struct RefreshManager {
    refresh_interval: Option<Duration>,
    cache: Arc<RwLock<HashMap<String, CachedParameter>>>,
}

impl RefreshManager {
    pub fn new() -> Self {
        let interval_str = std::env::var("CONFIG_REFRESH_INTERVAL").ok();
        let refresh_interval = interval_str
            .and_then(|s| s.parse::<i64>().ok())
            .map(|seconds| {
                if seconds == -1 {
                    None
                } else {
                    Some(Duration::from_secs(seconds as u64))
                }
            })
            .unwrap_or(Some(Duration::from_secs(300)));

        info!(
            "Parameter refresh interval: {}",
            match refresh_interval {
                Some(d) => format!("{} seconds", d.as_secs()),
                None => "disabled".to_string(),
            }
        );

        Self {
            refresh_interval,
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn should_refresh(&self, key: &str) -> bool {
        if self.refresh_interval.is_none() {
            return false;
        }

        let cache = self.cache.read().await;
        match cache.get(key) {
            None => true,
            Some(cached) => {
                let elapsed = cached.timestamp.elapsed();
                elapsed > self.refresh_interval.unwrap()
            }
        }
    }

    pub async fn get_cached(&self, key: &str) -> Option<String> {
        let cache = self.cache.read().await;
        cache.get(key).map(|c| c.value.clone())
    }

    pub async fn cache_parameter(&self, key: String, value: String) {
        let mut cache = self.cache.write().await;
        cache.insert(
            key.clone(),
            CachedParameter {
                value,
                timestamp: Instant::now(),
            },
        );
        info!("Cached parameter: {}", key);
    }
}
