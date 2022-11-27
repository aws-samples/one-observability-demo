# COP301 Backend API on Amazon ECS

```console
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

## Create ECR repository

Skip this step if you already have a repository

```console
ECR_REPOSITORY_URI=$(aws ecr create-repository --repository cop301-api --query repository.repositoryUri --output text)
```

```console
ECR_REPOSITORY_URI=$(aws ecr describe-repositories --repository-names cop301-api --query 'repositories[0].repositoryUri' --output text)
```


## Build image

```console
docker buildx build . -t cop301-api --platform=linux/amd64
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_REPOSITORY_URI
docker tag cop301-api:latest $ECR_REPOSITORY_URI
docker push $ECR_REPOSITORY_URI
```

## Deploy application (on Amazon ECS)

```console
copilot svc init --name cop301-api
copilot svc deploy --name cop301-api --env test
```

## Benchmark (optional)

Drill is a HTTP load testing application written in Rust. Follow this link [to install](https://github.com/fcsonline/drill#install).
If you have [Cargo](https://github.com/fcsonline/drill#install), run:

```console
cargo install drill
```

Running the benchmark scenario

```console
drill -s --benchmark utils/benchmark.yaml
```
