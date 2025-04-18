## Drill for PetListAdoptions

Using [drill](https://github.com/fcsonline/drill), this allows to generate
traffic in the PetSite EKS cluster or locally in dev, without spinning ECS
traffic generator.

This can be useful to test all APIs or boost traffic for Application Signals.

### (Optional) Pick your benchmark environment

In the `benchmark.yaml` file, change the base URL to your PetListAdoptions ALB
endpoint if you are not testing it locally as the default is local.

```yaml
concurrency: 4
base: "http://Servic-lista-[...].eu-central-1.elb.amazonaws.com"
```

### Running locally

[Install drill](https://github.com/fcsonline/drill?tab=readme-ov-file#install)
and run

```bash
drill --benchmark benchmark.yaml
```

### Running in EKS

1. Authenticate against your EKS cluster

```bash
aws eks update-kubeconfig --name PetSite --region <AWS_REGION>
```

2. Create an ECR image `drill-petlistadoptions`

3. Build and push

```bash
aws ecr get-login-password --region <YOUR REGION> | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
docker buildx build -t drill-petlistadoptions . --platform=linux/amd64
docker tag drill-petlistadoptions:latest <ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/drill-petlistadoptions:latest
docker push <ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/drill-petlistadoptions:latest
```

4. Run in EKS

```bash
kubectl run -it drill-petlistadoptions --image <ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/drill-petlistadoptions:latest
```

