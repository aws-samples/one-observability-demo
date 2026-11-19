//! Business telemetry: custom OpenTelemetry metrics for orders and EventBridge events.
//!
//! These complement the request-level metrics in `metrics.rs` with what the business cares about:
//! how many orders are placed or fail and why, how much they are worth, and whether the events that
//! drive stock processing actually reach EventBridge. Instruments are created on first use from the
//! global meter provider, which `init_observability` installs before any request is served.
//!
//! Attribute values come from fixed sets (outcome, failure reason, payment method, event type) to
//! keep cardinality bounded.

use opentelemetry::{
    global,
    metrics::{Counter, Histogram},
    KeyValue,
};
use std::sync::OnceLock;

use crate::models::ServiceError;

struct BusinessInstruments {
    orders: Counter<u64>,
    order_amount: Histogram<f64>,
    order_items: Histogram<u64>,
    events: Counter<u64>,
}

fn instruments() -> &'static BusinessInstruments {
    static INSTRUMENTS: OnceLock<BusinessInstruments> = OnceLock::new();
    INSTRUMENTS.get_or_init(|| {
        let meter = global::meter("petfood-rs");
        BusinessInstruments {
            orders: meter
                .u64_counter("petfood.orders")
                .with_description("Checkout attempts by outcome")
                .with_unit("{order}")
                .build(),
            order_amount: meter
                .f64_histogram("petfood.order.amount")
                .with_description("Total amount of confirmed orders, including tax and shipping")
                .with_unit("USD")
                .with_boundaries(vec![5.0, 10.0, 20.0, 30.0, 50.0, 75.0, 100.0, 150.0, 250.0])
                .build(),
            order_items: meter
                .u64_histogram("petfood.order.items")
                .with_description("Number of items in confirmed orders")
                .with_unit("{item}")
                .with_boundaries(vec![1.0, 2.0, 3.0, 4.0, 5.0, 8.0, 13.0, 21.0])
                .build(),
            events: meter
                .u64_counter("petfood.events.emitted")
                .with_description("EventBridge events by type and delivery outcome, after retries")
                .with_unit("{event}")
                .build(),
        }
    })
}

/// Record a confirmed order.
pub fn record_order_confirmed(payment_method: &str, amount_usd: f64, item_count: u64) {
    let i = instruments();
    let payment = KeyValue::new("payment.method", payment_method.to_string());
    i.orders
        .add(1, &[KeyValue::new("outcome", "confirmed"), payment.clone()]);
    i.order_amount
        .record(amount_usd, std::slice::from_ref(&payment));
    i.order_items.record(item_count, &[payment]);
}

/// Record a checkout that failed, with a reason from `checkout_failure_reason`.
pub fn record_order_failed(reason: &'static str) {
    instruments().orders.add(
        1,
        &[
            KeyValue::new("outcome", "failed"),
            KeyValue::new("failure.reason", reason),
        ],
    );
}

/// Record the final outcome of delivering one event to EventBridge.
pub fn record_event(event_type: &str, delivered: bool) {
    instruments().events.add(
        1,
        &[
            KeyValue::new("event.type", event_type.to_string()),
            KeyValue::new("outcome", if delivered { "delivered" } else { "failed" }),
        ],
    );
}

/// Bounded, low-cardinality reason for a failed checkout.
pub fn checkout_failure_reason(error: &ServiceError) -> &'static str {
    match error {
        ServiceError::CartNotFound { .. } => "cart_not_found",
        ServiceError::ValidationError { .. } => "invalid_request",
        ServiceError::FoodNotFound { .. } => "food_not_found",
        ServiceError::ProductUnavailable { .. } => "product_unavailable",
        ServiceError::InsufficientStock { .. } => "insufficient_stock",
        ServiceError::Repository { .. } => "repository_error",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failure_reasons_are_bounded() {
        let cases = [
            (
                ServiceError::CartNotFound {
                    user_id: "u".into(),
                },
                "cart_not_found",
            ),
            (
                ServiceError::ValidationError {
                    message: "Cannot checkout empty cart".into(),
                },
                "invalid_request",
            ),
            (
                ServiceError::InsufficientStock {
                    requested: 3,
                    available: 1,
                },
                "insufficient_stock",
            ),
            (
                ServiceError::ProductUnavailable {
                    food_id: "F1".into(),
                },
                "product_unavailable",
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(checkout_failure_reason(&error), expected);
        }
    }

    #[test]
    fn recording_without_a_meter_provider_is_a_no_op() {
        // The global noop provider must not panic when no exporter is configured (as in unit tests)
        record_order_confirmed("PayPal", 42.5, 3);
        record_order_failed("cart_not_found");
        record_event("StockPurchased", true);
    }
}
