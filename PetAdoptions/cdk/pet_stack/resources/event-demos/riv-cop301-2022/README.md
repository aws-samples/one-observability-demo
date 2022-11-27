# re:Invent 2022 COP301 demo

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

2. Amazon ECS API

Visit [the documentation](./ecs-api/README) to deploy the Amazon ECS backend API.

3. Webapp (with AWS Amplify)

### Visualization with Amazon Managed Grafana

Visit the [getting started page](https://docs.aws.amazon.com/grafana/latest/userguide/getting-started-with-AMG.html) to create an Amazon Managed Grafana workspace and create your dashboard.

<img width="2056" alt="image" src="https://user-images.githubusercontent.com/10175027/204155180-b22d7f41-f773-458c-a570-160b44a8ec10.png">


### Feedback
