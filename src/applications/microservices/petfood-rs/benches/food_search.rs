use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use rust_decimal::prelude::FromPrimitive;
use std::sync::Arc;
use std::time::Duration;
use tokio::runtime::Runtime;

// Config imports removed as they're no longer needed
use petfood_rs::models::{CreateFoodRequest, FoodFilters, FoodType, PetType};
use petfood_rs::repositories::food_repository::DynamoDbFoodRepository;
use petfood_rs::services::food_service::FoodService;
use rust_decimal_macros::dec;

async fn create_test_clients() -> (Arc<aws_sdk_dynamodb::Client>, Arc<aws_sdk_ssm::Client>) {
    let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let dynamodb_client = Arc::new(aws_sdk_dynamodb::Client::new(&aws_config));
    let ssm_client = Arc::new(aws_sdk_ssm::Client::new(&aws_config));
    (dynamodb_client, ssm_client)
}

async fn setup_test_data(food_service: &FoodService, num_foods: usize) {
    let pet_types = [PetType::Puppy, PetType::Kitten, PetType::Bunny];
    let food_types = [
        FoodType::Dry,
        FoodType::Wet,
        FoodType::Treats,
        FoodType::Supplements,
    ];

    for i in 0..num_foods {
        let pet_type = pet_types[i % pet_types.len()].clone();
        let food_type = food_types[i % food_types.len()].clone();

        let request = CreateFoodRequest {
            pet_type,
            name: format!("Benchmark Food {}", i),
            food_type,
            description: format!("Description for benchmark food {}", i),
            price: dec!(10.99)
                + rust_decimal::Decimal::from_f64(i as f64 * 0.1).unwrap_or(dec!(0.0)),
            image: format!("food-{}.jpg", i),
            nutritional_info: None,
            ingredients: vec!["ingredient1".to_string(), "ingredient2".to_string()],
            feeding_guidelines: Some("Feed as needed".to_string()),
            stock_quantity: 100,
        };

        let _ = food_service.create_food(request).await;
    }
}

fn bench_food_search_by_pet_type(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("food_search_by_pet_type");
    group.sample_size(50);
    group.measurement_time(Duration::from_secs(10));

    for dataset_size in [100, 500, 1000].iter() {
        group.bench_with_input(
            BenchmarkId::new("dataset_size", dataset_size),
            dataset_size,
            |b, &size| {
                b.iter_batched(
                    || {
                        rt.block_on(async {
                            let (client, _) = create_test_clients().await;
                            let repository = Arc::new(DynamoDbFoodRepository::new(
                                client,
                                "benchmark-foods".to_string(),
                            ));
                            let food_service = FoodService::new(repository.clone());

                            // Setup test data
                            setup_test_data(&food_service, size).await;

                            food_service
                        })
                    },
                    |food_service| {
                        rt.block_on(async move {
                            let filters = FoodFilters {
                                pet_type: Some(PetType::Puppy),
                                food_type: None,
                                availability_status: None,
                                min_price: None,
                                max_price: None,
                                search_term: None,
                                in_stock_only: Some(false),
                            };

                            black_box(food_service.list_foods(filters).await.unwrap())
                        })
                    },
                    criterion::BatchSize::SmallInput,
                );
            },
        );
    }
    group.finish();
}

fn bench_food_search_by_food_type(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("food_search_by_food_type");
    group.sample_size(50);
    group.measurement_time(Duration::from_secs(10));

    for dataset_size in [100, 500, 1000].iter() {
        group.bench_with_input(
            BenchmarkId::new("dataset_size", dataset_size),
            dataset_size,
            |b, &size| {
                b.iter_batched(
                    || {
                        rt.block_on(async {
                            let (client, _) = create_test_clients().await;
                            let repository = Arc::new(DynamoDbFoodRepository::new(
                                client,
                                "benchmark-foods".to_string(),
                            ));
                            let food_service = FoodService::new(repository.clone());

                            // Setup test data
                            setup_test_data(&food_service, size).await;

                            food_service
                        })
                    },
                    |food_service| {
                        rt.block_on(async move {
                            let filters = FoodFilters {
                                pet_type: None,
                                food_type: Some(FoodType::Dry),
                                availability_status: None,
                                min_price: None,
                                max_price: None,
                                search_term: None,
                                in_stock_only: Some(false),
                            };

                            black_box(food_service.list_foods(filters).await.unwrap())
                        })
                    },
                    criterion::BatchSize::SmallInput,
                );
            },
        );
    }
    group.finish();
}

fn bench_food_search_combined_filters(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("food_search_combined_filters");
    group.sample_size(50);
    group.measurement_time(Duration::from_secs(10));

    for dataset_size in [100, 500, 1000].iter() {
        group.bench_with_input(
            BenchmarkId::new("dataset_size", dataset_size),
            dataset_size,
            |b, &size| {
                b.iter_batched(
                    || {
                        rt.block_on(async {
                            let (client, _) = create_test_clients().await;
                            let repository = Arc::new(DynamoDbFoodRepository::new(
                                client,
                                "benchmark-foods".to_string(),
                            ));
                            let food_service = FoodService::new(repository.clone());

                            // Setup test data
                            setup_test_data(&food_service, size).await;

                            food_service
                        })
                    },
                    |food_service| {
                        rt.block_on(async move {
                            let filters = FoodFilters {
                                pet_type: Some(PetType::Puppy),
                                food_type: Some(FoodType::Dry),
                                availability_status: None,
                                min_price: Some(dec!(5.0)),
                                max_price: Some(dec!(20.0)),
                                search_term: None,
                                in_stock_only: Some(true),
                            };

                            black_box(food_service.list_foods(filters).await.unwrap())
                        })
                    },
                    criterion::BatchSize::SmallInput,
                );
            },
        );
    }
    group.finish();
}

fn bench_food_get_by_id(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("food_get_by_id");
    group.sample_size(100);
    group.measurement_time(Duration::from_secs(10));

    group.bench_function("single_lookup", |b| {
        b.iter_batched(
            || {
                rt.block_on(async {
                    let (client, _) = create_test_clients().await;
                    let repository = Arc::new(DynamoDbFoodRepository::new(
                        client,
                        "benchmark-foods".to_string(),
                    ));
                    let food_service = FoodService::new(repository.clone());

                    // Create a single food item
                    let request = CreateFoodRequest {
                        pet_type: PetType::Puppy,
                        name: "Benchmark Food".to_string(),
                        food_type: FoodType::Dry,
                        description: "Description for benchmark food".to_string(),
                        price: dec!(10.99),
                        image: "food.jpg".to_string(),
                        nutritional_info: None,
                        ingredients: vec!["ingredient1".to_string()],
                        feeding_guidelines: Some("Feed as needed".to_string()),
                        stock_quantity: 100,
                    };

                    let created_food = food_service.create_food(request).await.unwrap();
                    (food_service, created_food.id)
                })
            },
            |(food_service, food_id)| {
                rt.block_on(
                    async move { black_box(food_service.get_food(&food_id).await.unwrap()) },
                )
            },
            criterion::BatchSize::SmallInput,
        );
    });

    group.finish();
}

criterion_group!(
    benches,
    bench_food_search_by_pet_type,
    bench_food_search_by_food_type,
    bench_food_search_combined_filters,
    bench_food_get_by_id
);
criterion_main!(benches);
