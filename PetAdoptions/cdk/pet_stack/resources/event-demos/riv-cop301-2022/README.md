# AWS re:Invent 2022 COP301 demo

This contains the sources artifacts to deploy the COP301 session.

### Architecture diagram

<img width="1379" alt="image" src="https://user-images.githubusercontent.com/10175027/204154406-acdac097-31f3-4402-aaad-e421246be6e2.png">

### Deployment

#### AWS Lambda API

Make sure to have [AWS SAM CLI](https://aws.amazon.com/serverless/sam/) installed to run these commands.

```
cd lambda-api
npm install
sam sync --stack-name cop301-data
```

#### Amazon ECS API

Visit [the documentation](./ecs-api/README.md) to deploy the Amazon ECS backend API.

#### Webapp (with AWS Amplify)

<img width="543" alt="Screenshot 2022-11-27 at 11 31 31" src="https://user-images.githubusercontent.com/10175027/204155839-9505cd12-1b59-458c-a073-747da1e73d84.png">

Visit [the documentation](./amplifyapp/README.md) to deploy the web app with AWS Amplify.

### Visualization with Amazon Managed Grafana

Visit the [getting started page](https://docs.aws.amazon.com/grafana/latest/userguide/getting-started-with-AMG.html) to create an Amazon Managed Grafana workspace and create your dashboard.

<img width="2054" alt="image" src="https://user-images.githubusercontent.com/10175027/204155560-aa9b6a40-d7ec-4da4-a5af-82cd74aeecb1.png">

