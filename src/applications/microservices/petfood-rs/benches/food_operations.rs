use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use rust_decimal::prelude::FromPrimitive;
use std::sync::Arc;
use std::time::Duration;
use tokio::runtime::Runtime;

use petfood_rs::models::{
    CreateFoodRequest, CreationSource, Food, FoodFilters, FoodType, PetType, RepositoryError,
};
use petfood_rs::repositories::FoodRepository;
use petfood_rs::services::food_service::FoodService;
use rust_decimal_macros::dec;

use async_trait::async_trait;
use std::collections::HashMap;

/// Mock repository for benchmarking that doesn't require AWS connectivity
#[derive(Clone)]
struct MockFoodRepository {
    foods: Arc<std::sync::Mutex<HashMap<String, Food>>>,
}

impl MockFoodRepository {
    fn new() -> Self {
        Self {
            foods: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }

    fn with_test_data(size: usize) -> Self {
        let repo = Self::new();
        let pet_types = [PetType::Puppy, PetType::Kitten, PetType::Bunny];
        let food_types = [
            FoodType::Dry,
            FoodType::Wet,
            FoodType::Treats,
            FoodType::Supplements,
        ];

        for i in 0..size {
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

            let food = Food::new(request);
            repo.foods.lock().unwrap().insert(food.id.clone(), food);
        }

        repo
    }
}

#[async_trait]
impl FoodRepository for MockFoodRepository {
    async fn find_all(&self, filters: FoodFilters) -> Result<Vec<Food>, RepositoryError> {
        let foods = self.foods.lock().unwrap();
        let mut result: Vec<Food> = foods.values().cloned().collect();

        // Apply filters
        if let Some(pet_type) = &filters.pet_type {
            result.retain(|f| &f.pet_type == pet_type);
        }
        if let Some(food_type) = &filters.food_type {
            result.retain(|f| &f.food_type == food_type);
        }
        if let Some(min_price) = filters.min_price {
            result.retain(|f| f.price >= min_price);
        }
        if let Some(max_price) = filters.max_price {
            result.retain(|f| f.price <= max_price);
        }
        if let Some(in_stock_only) = filters.in_stock_only {
            if in_stock_only {
                result.retain(|f| f.stock_quantity > 0);
            }
        }

        Ok(result)
    }

    async fn find_by_id(&self, id: &str) -> Result<Option<Food>, RepositoryError> {
        let foods = self.foods.lock().unwrap();
        Ok(foods.get(id).cloned())
    }

    async fn find_by_pet_type(&self, pet_type: PetType) -> Result<Vec<Food>, RepositoryError> {
        let foods = self.foods.lock().unwrap();
        let result: Vec<Food> = foods
            .values()
            .filter(|f| f.pet_type == pet_type)
            .cloned()
            .collect();
        Ok(result)
    }

    async fn find_by_food_type(&self, food_type: FoodType) -> Result<Vec<Food>, RepositoryError> {
        let foods = self.foods.lock().unwrap();
        let result: Vec<Food> = foods
            .values()
            .filter(|f| f.food_type == food_type)
            .cloned()
            .collect();
        Ok(result)
    }

    async fn create(&self, food: Food) -> Result<Food, RepositoryError> {
        let mut foods = self.foods.lock().unwrap();
        foods.insert(food.id.clone(), food.clone());
        Ok(food)
    }

    async fn update(&self, food: Food) -> Result<Food, RepositoryError> {
        let mut foods = self.foods.lock().unwrap();
        foods.insert(food.id.clone(), food.clone());
        Ok(food)
    }

    async fn soft_delete(&self, id: &str) -> Result<(), RepositoryError> {
        let mut foods = self.foods.lock().unwrap();
        if let Some(mut food) = foods.get(id).cloned() {
            food.availability_status = petfood_rs::models::AvailabilityStatus::Discontinued;
            foods.insert(id.to_string(), food);
        }
        Ok(())
    }

    async fn delete(&self, id: &str) -> Result<(), RepositoryError> {
        let mut foods = self.foods.lock().unwrap();
        foods.remove(id);
        Ok(())
    }

    async fn exists(&self, id: &str) -> Result<bool, RepositoryError> {
        let foods = self.foods.lock().unwrap();
        Ok(foods.contains_key(id))
    }

    async fn count(&self, filters: Option<FoodFilters>) -> Result<usize, RepositoryError> {
        if let Some(filters) = filters {
            let foods = self.find_all(filters).await?;
            Ok(foods.len())
        } else {
            let foods = self.foods.lock().unwrap();
            Ok(foods.len())
        }
    }
}

fn bench_food_search_by_pet_type(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("food_search_by_pet_type");
    group.sample_size(100);
    group.measurement_time(Duration::from_secs(5));

    for dataset_size in [100, 500, 1000].iter() {
        group.bench_with_input(
            BenchmarkId::new("dataset_size", dataset_size),
            dataset_size,
            |b, &size| {
                let repository = Arc::new(MockFoodRepository::with_test_data(size));
                let food_service = FoodService::new(repository);

                b.iter(|| {
                    rt.block_on(async {
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
                });
            },
        );
    }
    group.finish();
}

fn bench_food_search_by_food_type(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("food_search_by_food_type");
    group.sample_size(100);
    group.measurement_time(Duration::from_secs(5));

    for dataset_size in [100, 500, 1000].iter() {
        group.bench_with_input(
            BenchmarkId::new("dataset_size", dataset_size),
            dataset_size,
            |b, &size| {
                let repository = Arc::new(MockFoodRepository::with_test_data(size));
                let food_service = FoodService::new(repository);

                b.iter(|| {
                    rt.block_on(async {
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
                });
            },
        );
    }
    group.finish();
}

fn bench_food_search_combined_filters(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("food_search_combined_filters");
    group.sample_size(100);
    group.measurement_time(Duration::from_secs(5));

    for dataset_size in [100, 500, 1000].iter() {
        group.bench_with_input(
            BenchmarkId::new("dataset_size", dataset_size),
            dataset_size,
            |b, &size| {
                let repository = Arc::new(MockFoodRepository::with_test_data(size));
                let food_service = FoodService::new(repository);

                b.iter(|| {
                    rt.block_on(async {
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
                });
            },
        );
    }
    group.finish();
}

fn bench_food_get_by_id(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("food_get_by_id");
    group.sample_size(200);
    group.measurement_time(Duration::from_secs(5));

    group.bench_function("single_lookup", |b| {
        let repository = Arc::new(MockFoodRepository::with_test_data(1000));
        let food_service = FoodService::new(repository.clone());

        // Get a food ID from the repository
        let food_id = rt.block_on(async {
            let foods = repository.find_all(FoodFilters::default()).await.unwrap();
            foods[0].id.clone()
        });

        b.iter(|| rt.block_on(async { black_box(food_service.get_food(&food_id).await.unwrap()) }));
    });

    group.finish();
}

fn bench_food_create(c: &mut Criterion) {
    let rt = Runtime::new().unwrap();

    let mut group = c.benchmark_group("food_create");
    group.sample_size(100);
    group.measurement_time(Duration::from_secs(5));

    group.bench_function("create_single", |b| {
        b.iter_batched(
            || {
                let repository = Arc::new(MockFoodRepository::new());
                let food_service = FoodService::new(repository);

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

                (food_service, request)
            },
            |(food_service, request)| {
                rt.block_on(async move {
                    black_box(
                        food_service
                            .create_food(request, CreationSource::Seeding)
                            .await
                            .unwrap(),
                    )
                })
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
    bench_food_get_by_id,
    bench_food_create
);
criterion_main!(benches);
